"""
ai/memory_store.py
==================
Prioritized Experience Replay (PER) buffer using a sum-tree data structure.

Reference: Schaul et al. "Prioritized Experience Replay" (ICLR 2016)
           https://arxiv.org/abs/1511.05952
           Improves sample efficiency 2–4× vs uniform replay.

Algorithm:
  Priority p_i = |δ_i|^α + ε   where δ_i = TD error, α=0.6, ε=1e-6
  Sampling probability P(i) = p_i / Σ_j p_j

  Stratified sampling for batch of size k:
    Divide total priority into k equal segments [P(i-1)/k, P(i)/k]
    Sample one transition per segment → ensures coverage of priority range

  Importance sampling weights (correct for sampling bias):
    w_i = (N · P(i))^{−β} / max_j w_j   with β annealing 0.4 → 1.0

Sum-tree: binary tree where each leaf stores priority p_i
  and each internal node stores the sum of its children.
  Supports O(log N) update and O(log N) prefix-sum retrieval.

  Tree layout (1-indexed):
    index 1       = root (total sum)
    index 2,3     = level 1 children
    index 4..7    = level 2 children
    ...
    index N..2N-1 = leaves (actual priorities)
"""

from __future__ import annotations

import json
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_CAPACITY   = 10_000
_ALPHA      = 0.6    # priority exponent
_BETA_INIT  = 0.4    # IS weight exponent (anneals to 1.0)
_BETA_STEPS = 50_000 # steps to anneal β from 0.4 → 1.0
_EPSILON    = 1e-6   # minimum priority


class SumTree:
    """
    Binary sum-tree for O(log N) priority updates and stratified sampling.
    Array layout: tree[0] unused; tree[1]=root; leaves at tree[N:2N].
    """

    def __init__(self, capacity: int):
        self.capacity = capacity
        self.tree     = np.zeros(2 * capacity)   # sum-tree storage
        self.data     = [None] * capacity         # actual transitions
        self._write   = 0                         # circular write pointer
        self._size    = 0

    def _propagate(self, idx: int, delta: float):
        """Update sum-tree ancestor nodes."""
        while idx > 1:
            parent      = idx >> 1
            self.tree[parent] += delta
            idx          = parent

    def _retrieve(self, idx: int, s: float) -> int:
        """Find leaf index for a given cumulative sum s."""
        while idx < self.capacity:   # while not a leaf
            left  = idx * 2
            right = left + 1
            if s <= self.tree[left]:
                idx = left
            else:
                s  -= self.tree[left]
                idx = right
        return idx

    @property
    def total(self) -> float:
        return float(self.tree[1])

    def add(self, priority: float, data: dict):
        leaf_idx = self._write + self.capacity
        old      = self.tree[leaf_idx]
        delta    = priority - old
        self.tree[leaf_idx] = priority
        self._propagate(leaf_idx, delta)
        self.data[self._write] = data
        self._write = (self._write + 1) % self.capacity
        self._size  = min(self._size + 1, self.capacity)

    def update(self, leaf_idx: int, priority: float):
        old   = self.tree[leaf_idx]
        delta = priority - old
        self.tree[leaf_idx] = priority
        self._propagate(leaf_idx, delta)

    def sample_by_value(self, s: float) -> tuple[int, float, Optional[dict]]:
        """Return (leaf_idx, priority, data) for cumulative value s."""
        leaf_idx   = self._retrieve(1, s)
        data_idx   = leaf_idx - self.capacity
        priority   = float(self.tree[leaf_idx])
        return leaf_idx, priority, self.data[data_idx]

    def __len__(self) -> int:
        return self._size


class PrioritizedReplayBuffer:
    """
    PER buffer wrapping a SumTree with β-annealing and IS weight computation.
    """

    def __init__(self, db=None, capacity: int = _CAPACITY):
        self._db       = db
        self._tree     = SumTree(capacity)
        self._alpha    = _ALPHA
        self._beta     = _BETA_INIT
        self._beta_inc = (1.0 - _BETA_INIT) / _BETA_STEPS
        self._max_priority: float = 1.0   # start with max priority for new transitions
        self._step: int = 0

    # ── Add ───────────────────────────────────────────────────────────────────
    def add(self, transition: dict, td_error: Optional[float] = None):
        """
        Add a transition. New transitions get max current priority
        (ensures they are sampled at least once before deprioritisation).
        """
        priority = (
            (abs(td_error) + _EPSILON) ** self._alpha
            if td_error is not None
            else self._max_priority
        )
        self._max_priority = max(self._max_priority, priority)
        self._tree.add(priority, transition)

    # ── Sample ────────────────────────────────────────────────────────────────
    def sample(self, batch_size: int) -> tuple[list[dict], np.ndarray, np.ndarray]:
        """
        Stratified sample of batch_size transitions.

        Returns
        -------
        transitions : list of dicts
        indices     : leaf indices (for priority update)
        is_weights  : importance sampling weights (normalised to max=1)
        """
        N = len(self._tree)
        if N == 0:
            return [], np.array([]), np.array([])

        total      = self._tree.total
        segment    = total / batch_size
        self._beta = min(1.0, self._beta + self._beta_inc)
        self._step += batch_size

        indices     = []
        priorities  = []
        transitions = []

        for i in range(batch_size):
            lo = segment * i
            hi = segment * (i + 1)
            s  = np.random.uniform(lo, hi)
            leaf_idx, p, data = self._tree.sample_by_value(s)
            if data is None:
                continue
            indices.append(leaf_idx)
            priorities.append(p)
            transitions.append(data)

        if not indices:
            return [], np.array([]), np.array([])

        priorities_arr = np.array(priorities, dtype=np.float64)
        # IS weights: w_i = (N · P(i))^{-β} / max_j w_j
        probs   = priorities_arr / max(total, 1e-12)
        weights = (N * probs) ** (-self._beta)
        weights /= weights.max()   # normalise

        return transitions, np.array(indices), weights

    # ── Update Priorities ─────────────────────────────────────────────────────
    def update_priorities(self, indices: np.ndarray, td_errors: np.ndarray):
        """Update priorities after learning — uses new TD errors."""
        for idx, td_err in zip(indices, td_errors):
            p = (abs(float(td_err)) + _EPSILON) ** self._alpha
            self._max_priority = max(self._max_priority, p)
            self._tree.update(int(idx), p)

    def __len__(self) -> int:
        return len(self._tree)
