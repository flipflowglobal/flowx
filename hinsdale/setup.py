#!/usr/bin/env python3
"""
Setup script for Hinsdale Cython extension.
Builds _hinsdale.so linking against libhinsdale.so.

Usage:
    python setup.py build_ext --inplace
    pip install -e .[dev,dashboard]
"""
import os
from setuptools import setup, Extension

try:
    from Cython.Build import cythonize
    USE_CYTHON = True
except ImportError:
    USE_CYTHON = False
    print("[WARNING] Cython not found — building from pre-generated C file")

HERE = os.path.dirname(os.path.abspath(__file__))
CYTHON_DIR = os.path.join(HERE, 'cython')
LIB_DIR = os.path.join(HERE, 'target', 'release')

ext_source = os.path.join(CYTHON_DIR, '_hinsdale.pyx' if USE_CYTHON else '_hinsdale.c')

extension = Extension(
    '_hinsdale',
    sources=[ext_source],
    include_dirs=[CYTHON_DIR],
    library_dirs=[LIB_DIR],
    libraries=['hinsdale'],
    runtime_library_dirs=[LIB_DIR],
    extra_compile_args=['-O3', '-march=native', '-ffast-math'],
    extra_link_args=['-Wl,-rpath,' + LIB_DIR],
)

extensions = cythonize(
    [extension],
    compiler_directives={
        'language_level': '3',
        'boundscheck': False,
        'wraparound': False,
        'cdivision': True,
        'nonecheck': False,
        'initializedcheck': False,
    }
) if USE_CYTHON else [extension]

setup(
    name='hinsdale',
    version='2.0.0',
    description='EVM bytecode decompiler with DeFi analytics — Python bindings',
    ext_modules=extensions,
    python_requires='>=3.8',
    install_requires=['numpy>=1.21'],
    extras_require={
        'dev': ['Cython>=3.0', 'pytest', 'pytest-benchmark'],
        'dashboard': ['rich>=13.0'],
    },
    packages=['hinsdale'],
    package_dir={'hinsdale': 'python'},
)
