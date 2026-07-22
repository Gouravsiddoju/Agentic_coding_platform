import pytest
from fibonacci import fib, fib_sequence


def test_fib_zero():
    assert fib(0) == 0, "fib(0) should return 0"


def test_fib_one():
    assert fib(1) == 1, "fib(1) should return 1"


def test_fib_small_numbers():
    # Known Fibonacci numbers
    known = {
        2: 1,
        3: 2,
        4: 3,
        5: 5,
        6: 8,
        7: 13,
        8: 21,
    }
    for n, expected in known.items():
        assert fib(n) == expected, f"fib({n}) should be {expected}"


def test_fib_large_number():
    # fib(50) is 12586269025
    assert fib(50) == 12586269025, "fib(50) should be 12586269025"


def test_fib_negative_input():
    with pytest.raises(ValueError):
        fib(-1)


def test_fib_sequence_zero():
    assert fib_sequence(0) == [], "fib_sequence(0) should return an empty list"


def test_fib_sequence_one():
    assert fib_sequence(1) == [0], "fib_sequence(1) should return [0]"


def test_fib_sequence_small():
    # Expected first 10 Fibonacci numbers starting with 0
    expected = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
    assert fib_sequence(10) == expected, "fib_sequence(10) returned incorrect sequence"


def test_fib_sequence_matches_fib_function():
    n = 15
    seq = fib_sequence(n)
    assert len(seq) == n, f"Sequence length should be {n}"
    for i, val in enumerate(seq):
        assert val == fib(i), f"Sequence element at index {i} should equal fib({i})"


def test_fib_sequence_negative_input():
    with pytest.raises(ValueError):
        fib_sequence(-5)


def test_fib_sequence_large():
    # Verify that fib_sequence(30) returns the correct last element
    seq = fib_sequence(30)
    assert seq[-1] == fib(29), "Last element should match fib(29)"
    assert seq[0] == 0 and seq[1] == 1, "Sequence should start with 0, 1"
    assert len(seq) == 30, "Sequence length should be 30"