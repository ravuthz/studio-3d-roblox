#!/usr/bin/env python3
"""Turn numbers (Latin 0-9 and Khmer ០-៩) into Khmer reading text, for TTS input only.

    python khmer_numbers.py "តម្លៃ 1,000$ ឬ ១០០០៛"      -> តម្លៃ មួយពាន់ដុល្លា ឬ មួយពាន់រៀល
    echo "ចំនួន 25%" | python khmer_numbers.py -            (read stdin)
    python khmer_numbers.py --file script.txt               (read a file)

As a module: `from khmer_numbers import speak_numbers`. Never feed the result to subtitles; keep the original text there.
"""
import re
import sys

ONES = ["សូន្យ", "មួយ", "ពីរ", "បី", "បួន", "ប្រាំ", "ប្រាំមួយ", "ប្រាំពីរ", "ប្រាំបី", "ប្រាំបួន"]
TENS = {1: "ដប់", 2: "ម្ភៃ", 3: "សាមសិប", 4: "សែសិប", 5: "ហាសិប", 6: "ហុកសិប", 7: "ចិតសិប", 8: "ប៉ែតសិប", 9: "កៅសិប"}
# Place values below one million, highest first: (divisor, word).
PLACES = [(100_000, "សែន"), (10_000, "ម៉ឺន"), (1_000, "ពាន់"), (100, "រយ")]

KH_DIGITS = "០១២៣៤៥៦៧៨៩"
_TO_LATIN = {ord(k): str(i) for i, k in enumerate(KH_DIGITS)}
INVISIBLE = "​‌‍⁠﻿"  # zero-width characters often sit between a number and its unit


def _below_million(n: int) -> str:
    out = []
    for div, word in PLACES:
        d, n = divmod(n, div)
        if d:
            out.append(ONES[d] + word)
    if n >= 10:
        out.append(TENS[n // 10])
        n %= 10
        if n:
            out.append(ONES[n])
    elif n:
        out.append(ONES[n])
    return "".join(out)


def int_to_khmer(n: int) -> str:
    """0 -> សូន្យ, 1000 -> មួយពាន់, 25000 -> ពីរម៉ឺនប្រាំពាន់, 1_000_000 -> មួយលាន."""
    if n == 0:
        return ONES[0]
    millions, rest = divmod(n, 1_000_000)
    head = int_to_khmer(millions) + "លាន" if millions else ""
    return head + (_below_million(rest) if rest else "")


def phone_to_khmer(s: str) -> str:
    """012345678 -> three-digit groups from the left, each read as a number: 012 345 678.
    Leading zeros in a group are spoken one by one (សូន្យ), so 012 is សូន្យដប់ពីរ."""
    out = []
    for i in range(0, len(s), 3):
        g = s[i : i + 3]
        stripped = g.lstrip("0")
        out.append(ONES[0] * (len(g) - len(stripped)) + (int_to_khmer(int(stripped)) if stripped else ""))
    return " ".join(out)


_EN_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_EN_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def int_to_english(n: int) -> str:
    """19 -> nineteen, 2024 -> two thousand twenty four."""
    if n < 20:
        return _EN_ONES[n]
    if n < 100:
        return _EN_TENS[n // 10] + (" " + _EN_ONES[n % 10] if n % 10 else "")
    for div, word in ((10**9, "billion"), (10**6, "million"), (1000, "thousand"), (100, "hundred")):
        if n >= div:
            q, r = divmod(n, div)
            return int_to_english(q) + " " + word + (" " + int_to_english(r) if r else "")
    raise AssertionError(n)


def _english_digits(run: str) -> str:
    if (len(run) > 1 and run[0] == "0") or len(run) > 12:
        return " ".join(_EN_ONES[int(c)] for c in run)  # codes and ids: digit by digit
    return int_to_english(int(run))


def digits_to_khmer(s: str) -> str:
    """Read digit by digit (phone numbers, ids, leading zeros, decimals)."""
    return "".join(ONES[int(c)] for c in s)


_D = "0-9" + KH_DIGITS
_NUM = rf"[{_D}]+(?:[,،][{_D}]{{3}})*(?:\.[{_D}]+)?"
_SP = rf"[ \t{INVISIBLE}]*"
# currency or percent before the number, the number, then currency or percent after it
_TOKEN = re.compile(
    rf"(?<![A-Za-z0-9_])(?:(?P<pre>[$៛]){_SP})?(?P<num>{_NUM})(?:{_SP}(?P<post>[$៛%]|រៀល|ដុល្លារ|ដុល្លា|USD|usd|KHR|khr|(?<=[{_D}])\s?riel)(?![A-Za-z]))?(?![A-Za-z0-9_])"
)

_CURRENCY = {"$": "ដុល្លា", "ដុល្លារ": "ដុល្លា", "ដុល្លា": "ដុល្លា", "USD": "ដុល្លា", "usd": "ដុល្លា", "៛": "រៀល", "រៀល": "រៀល", "KHR": "រៀល", "khr": "រៀល"}


def _read_number(raw: str) -> tuple[str, str, str]:
    """(spoken whole part, spoken fraction or "", raw fraction digits) for one numeric literal."""
    s = raw.translate(_TO_LATIN).replace(",", "").replace("،", "")
    whole, _, frac = s.partition(".")
    # Leading zeros ("012 345 678") or very long runs are ids, not quantities.
    if len(whole) > 15:
        spoken = digits_to_khmer(whole)
    elif len(whole) > 1 and whole[0] == "0":
        spoken = phone_to_khmer(whole)
    else:
        spoken = int_to_khmer(int(whole))
    return spoken, (digits_to_khmer(frac) if frac else ""), frac


def _sub(m: re.Match) -> str:
    unit_key = m.group("post") or m.group("pre")
    spoken, frac, raw_frac = _read_number(m.group("num"))
    if unit_key == "%":
        return spoken + (f"ក្បៀស{frac}" if frac else "") + "ភាគរយ"
    cur = _CURRENCY.get(unit_key)
    if cur == "ដុល្លា" and raw_frac and int(raw_frac) == 0 and len(raw_frac) <= 2:
        return spoken + cur  # "$3.00" is just three dollars
    if cur == "ដុល្លា" and 0 < len(raw_frac) <= 2 and int(raw_frac) > 0:
        cents = int(raw_frac.ljust(2, "0"))
        return f"{spoken}{cur}{int_to_khmer(cents)}សេន"
    out = spoken + (f"ក្បៀស{frac}" if frac else "")
    return out + (cur or "")


_ORDINAL = re.compile(rf"(?<![A-Za-z0-9_])(?P<num>[{_D}]+)(?:st|nd|rd|th)(?![A-Za-z0-9_])", re.IGNORECASE)
_RANGE = re.compile(rf"(?<![\w\-–—])(?P<a>{_NUM}){_SP}[-–—]{_SP}(?P<b>{_NUM})(?![\w\-–—])")


def _range(m: re.Match) -> str:
    # 10-20 and 3-4 are ranges; 012-345 (phone) and 2024-01-05 (dates) are not.
    if any(len(x) > 1 and x[0] in "0០" and x[1] in _D for x in (m.group("a"), m.group("b"))):
        return m.group(0)
    return f"{m.group('a')}ទៅ{m.group('b')}"


def speak_numbers(text: str) -> str:
    """Replace every standalone number (and its $, ៛, %, រៀល unit) with Khmer words; digits glued to Latin letters become English words."""
    text = _ORDINAL.sub(lambda m: "ទី" + int_to_khmer(int(m.group("num").translate(_TO_LATIN))), text)  # 1st -> ទីមួយ
    text = _RANGE.sub(_range, text)  # 10-20 -> ដប់ទៅម្ភៃ
    text = _TOKEN.sub(_sub, text)
    # Digits stuck to Latin letters (mp4, covid19, 4K) stay English: "mp four", "covid nineteen".
    return re.sub(
        r"(?<![0-9])(?P<n>[0-9]+)(?![0-9])",
        lambda m: (" " if m.start() and text[m.start() - 1].isascii() and text[m.start() - 1].isalpha() else "")
        + _english_digits(m.group("n"))
        + (" " if m.end() < len(text) and text[m.end()].isascii() and text[m.end()].isalpha() else "")
        if (m.start() and text[m.start() - 1].isascii() and text[m.start() - 1].isalpha()) or (m.end() < len(text) and text[m.end()].isascii() and text[m.end()].isalpha())
        else m.group(0),
        text,
    )


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--file"] and len(args) == 2:
        data = open(args[1], encoding="utf-8").read()
    elif args in ([], ["-"]):
        data = sys.stdin.read()
    else:
        data = " ".join(args)
    sys.stdout.write(speak_numbers(data))
