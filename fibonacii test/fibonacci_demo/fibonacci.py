#!/usr/bin/env python3
"""
fibonacci_demo.fibonacci

Core module providing Fibonacci number calculations and a simple CLI entry point.

Functions
---------
fib(n: int) -> int
    Return the n-th Fibonacci number (0-indexed).
fib_sequence(limit: int) -> list[int]
    Return a list of Fibonacci numbers less than or equal to `limit`.

CLI
---
Run the module directly or via `python -m fibonacci_demo.fibonacci` to use
the command line interface.

Examples
--------
$ python -m fibonacci_demo.fibonacci fib 10
55

$ python -m fibonacci_demo.fibonacci sequence 100
[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
"""

import sys
import argparse
from typing import List

__all__ = ["fib", "fib_sequence"]


def fib(n: int) -> int:
    """
    Compute the n-th Fibonacci number (0-indexed).

    Parameters
    ----------
    n : int
        The index of the desired Fibonacci number. Must be non-negative.

    Returns
    -------
    int
        The n-th Fibonacci number.

    Raises
    ------
    ValueError
        If n is negative.
    TypeError
        If n is not an integer.
    """
    if not isinstance(n, int):
        raise TypeError(f"n must be an integer, got {type(n).__name__}")
    if n < 0:
        raise ValueError("n must be non-negative")

    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def fib_sequence(limit: int) -> List[int]:
    """
    Generate Fibonacci numbers up to a given limit.

    Parameters
    ----------
    limit : int
        Upper bound for Fibonacci numbers to generate (inclusive).
        Must be non-negative.

    Returns
    -------
    list[int]
        List of Fibonacci numbers <= limit, in ascending order.

    Raises
    ------
    ValueError
        If limit is negative.
    TypeError
        If limit is not an integer.
    """
    if not isinstance(limit, int):
        raise TypeError(f"limit must be an integer, got {type(limit).__name__}")
    if limit < 0:
        raise ValueError("limit must be non-negative")

    sequence = []
    a, b = 0, 1
    while a <= limit:
        sequence.append(a)
        a, b = b, a + b
    return sequence


def _build_parser() -> argparse.ArgumentParser:
    """Construct the command line argument parser."""
    parser = argparse.ArgumentParser(
        description="Compute Fibonacci numbers or generate Fibonacci sequences."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subparser for 'fib'
    fib_parser = subparsers.add_parser("fib", help="Compute the n-th Fibonacci number")
    fib_parser.add_argument("n", type=int, help="Index of the Fibonacci number (0-indexed)")

    # Subparser for 'sequence'
    seq_parser = subparsers.add_parser(
        "sequence", help="Generate Fibonacci numbers up to a given limit"
    )
    seq_parser.add_argument(
        "limit", type=int, help="Upper bound for Fibonacci numbers to generate"
    )

    return parser


def main(argv: List[str] | None = None) -> None:
    """
    Entry point for the CLI.

    Parameters
    ----------
    argv : list[str] | None
        Command line arguments, excluding the program name. If None, uses sys.argv[1:].
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "fib":
            result = fib(args.n)
            print(result)
        elif args.command == "sequence":
            result = fib_sequence(args.limit)
            print(result)
        else:
            parser.error(f"Unknown command: {args.command}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()