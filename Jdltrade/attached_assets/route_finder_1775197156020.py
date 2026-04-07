"""
scanner/route_finder.py
=======================
Bellman-Ford negative cycle detection on a log-price directed graph.

Reference: Avellaneda & Stoikov "Arbitrage in the FX Market" (2008).
           The correct formulation: convert exchange rates to log-space,
           find negative-weight cycles ↔ product-of-rates > 1 (profit).

Graph construction:
  Nodes : token addresses (checksummed)
  Edges : (token_in → token_out) with weight = −log(rate)
          where rate = amountOut / amountIn

Negative cycle = profitable arbitrage:
  Σ weights < 0  ↔  Σ −log(rᵢ) < 0  ↔  log(∏ rᵢ) > 0  ↔  ∏ rᵢ > 1

Bellman-Ford (standard, V-1 relaxations):
  For each edge (u,v,w): if d[v] > d[u] + w → relax
  After V-1 relaxations: if any edge can still relax → negative cycle exists
  Trace cycle using predecessor array.

Complexity: O(V·E) per source node.
Token whitelist limits V to ~12 nodes and E to ~200 edges.
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import networkx as nx

logger = logging.getLogger(__name__)

# Supported tokens for cycle search (liquid mainnet tokens only)
TOKEN_WHITELIST = {
    "WETH", "USDC", "USDT", "DAI", "WBTC",
    "stETH", "rETH", "FRAX", "LINK", "UNI", "AAVE", "LUSD",
}


class RouteFinder:
    """
    Builds a directed log-price graph from live quotes and finds
    profitable arbitrage cycles via Bellman-Ford.
    """

    def __init__(self, config=None):
        self._config = config

    # ── Graph Construction ────────────────────────────────────────────────────
    def build_log_price_graph(
        self,
        quotes: dict[tuple[str, str, str], float],
        # key: (token_in_addr, token_out_addr, pool_id_str) → rate (amountOut/amountIn)
    ) -> nx.DiGraph:
        """
        Construct directed multigraph in log-price space.

        Edge weight = −log(rate)
        Edge data includes: protocol, pool, fee, token_in, token_out, rate
        """
        G = nx.DiGraph()
        for (token_in, token_out, pool_id), rate in quotes.items():
            if rate <= 0:
                continue
            weight = -math.log(rate)
            edge_data = {
                "weight":    weight,
                "rate":      rate,
                "pool":      pool_id,
                "token_in":  token_in,
                "token_out": token_out,
            }
            # Keep only the best (lowest weight) edge between two tokens
            if G.has_edge(token_in, token_out):
                if G[token_in][token_out]["weight"] > weight:
                    G[token_in][token_out].update(edge_data)
            else:
                G.add_edge(token_in, token_out, **edge_data)
        return G

    # ── Bellman-Ford Negative Cycle Detection ─────────────────────────────────
    def find_negative_cycles(
        self,
        G: nx.DiGraph,
        start_token: str,
        max_hops: int = 4,
    ) -> list[list[dict]]:
        """
        Detect all negative-weight cycles reachable from start_token.

        Implementation:
          1. Run Bellman-Ford initialised from start_token (d[start]=0, rest=+∞)
          2. After V-1 relaxations, perform one more pass
          3. Any edge (u,v) that still relaxes → v is on or reachable from a neg cycle
          4. Trace the cycle backward through the predecessor array
          5. Filter cycles of length ≤ max_hops that pass through start_token

        Returns list of routes, each a list of step dicts:
          {token_in, token_out, pool, rate, protocol, fee}
        """
        if start_token not in G:
            return []

        nodes = list(G.nodes())
        V     = len(nodes)
        if V < 2:
            return []

        # Index nodes
        idx = {n: i for i, n in enumerate(nodes)}
        edges_list = [(u, v, G[u][v]) for u, v in G.edges()]

        # Bellman-Ford distances and predecessors
        INF  = float("inf")
        dist = [INF] * V
        pred = [None] * V
        dist[idx[start_token]] = 0.0

        # V-1 relaxations
        for _ in range(V - 1):
            updated = False
            for u, v, data in edges_list:
                iu, iv = idx[u], idx[v]
                if dist[iu] < INF and dist[iu] + data["weight"] < dist[iv]:
                    dist[iv] = dist[iu] + data["weight"]
                    pred[iv] = u
                    updated  = True
            if not updated:
                break  # early termination

        # Detect negative cycle: one more relaxation pass
        neg_cycle_nodes: set[str] = set()
        for u, v, data in edges_list:
            iu, iv = idx[u], idx[v]
            if dist[iu] < INF and dist[iu] + data["weight"] < dist[iv] - 1e-12:
                neg_cycle_nodes.add(v)

        if not neg_cycle_nodes:
            return []

        # Trace cycles and filter for those passing through start_token
        cycles: list[list[dict]] = []
        seen_hashes: set[str] = set()

        for entry in neg_cycle_nodes:
            cycle = self._trace_cycle(G, entry, pred, start_token, max_hops)
            if cycle is None:
                continue
            cycle_hash = "→".join(s["token_in"] for s in cycle)
            if cycle_hash in seen_hashes:
                continue
            seen_hashes.add(cycle_hash)
            cycles.append(cycle)

        # Sort by estimated profit (most negative total weight first)
        def cycle_weight(c: list[dict]) -> float:
            return sum(-math.log(s["rate"]) for s in c if s["rate"] > 0)

        cycles.sort(key=cycle_weight)   # ascending (most negative = best)
        logger.debug(f"Bellman-Ford: {len(neg_cycle_nodes)} neg-cycle nodes → {len(cycles)} valid cycles")
        return cycles

    def _trace_cycle(
        self,
        G: nx.DiGraph,
        entry: str,
        pred: list[Optional[str]],
        start_token: str,
        max_hops: int,
    ) -> Optional[list[dict]]:
        """
        Trace backward from entry through predecessors to find the cycle.
        Returns None if cycle doesn't include start_token or exceeds max_hops.
        """
        visited: list[str] = []
        node = entry
        nodes_set = set(G.nodes())

        for _ in range(max_hops + 1):
            if node in visited:
                # Found the cycle start
                cycle_start_idx = visited.index(node)
                cycle_nodes = visited[cycle_start_idx:]
                break
            visited.append(node)
            node_idx = list(G.nodes()).index(node) if node in nodes_set else -1
            next_node = pred[node_idx] if 0 <= node_idx < len(pred) else None
            if next_node is None:
                return None
            node = next_node
        else:
            return None

        if start_token not in cycle_nodes:
            return None
        if len(cycle_nodes) < 2 or len(cycle_nodes) > max_hops:
            return None

        # Build step dicts from cycle_nodes
        steps = []
        for i in range(len(cycle_nodes)):
            tok_in  = cycle_nodes[i]
            tok_out = cycle_nodes[(i + 1) % len(cycle_nodes)]
            if not G.has_edge(tok_in, tok_out):
                return None
            edata = G[tok_in][tok_out]
            steps.append({
                "token_in":  tok_in,
                "token_out": tok_out,
                "pool":      edata.get("pool", ""),
                "protocol":  edata.get("protocol", "uniswap_v3"),
                "fee":       edata.get("fee", 3000),
                "rate":      edata.get("rate", 1.0),
            })
        return steps if steps else None

    # ── Public Interface ──────────────────────────────────────────────────────
    def find_arbitrage_cycles(
        self,
        start_token: str,
        max_hops: int = 4,
        quote_map: Optional[dict] = None,
    ) -> list[list[dict]]:
        """
        Main entry point. Requires a quote_map from the scanner.
        quote_map: {(token_in, token_out, pool_id): rate}
        """
        if not quote_map:
            logger.debug("RouteFinder: no quote map provided")
            return []
        G = self.build_log_price_graph(quote_map)
        return self.find_negative_cycles(G, start_token, max_hops=max_hops)
