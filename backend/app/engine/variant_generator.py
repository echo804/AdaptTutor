"""变式题生成器（M3：变式题有解）。

## 为什么不能"平移数字了事"

平移法（题干所有整数 +delta、选项也 +delta、答案字母不变）在数学上必然产生无解题：

    原题  计算 $-3 - 5 = ?$   选项 [2, -8, 8, -2]   答案 B（-8，真值 -8）✓
    变式  计算 $-4 - 6 = ?$   选项 [3, -9, 9, -3]   答案 B（-9，真值 -10）✗

真值变了，答案字母却没跟着走 —— 选项里根本没有正确答案，学生答对真值仍被判错。
blank 分支同样错：`当 $x=2$ 时 $3x+1$ 的值为？` 平移后题干是 `x=3, 4x+2`（真值 14），
而答案是把原答案 7 平移成 8。

## 本模块的做法：整题重算 + 独立校验

1. 平移题干数字 → 得到新题干；
2. **解出新题干的真值**（安全算式求值器；解不出 → 拒绝生成，绝不猜）；
3. 用"原选项相对原真值的偏移"重建选项：new_opt = new_true + (old_opt - old_true)。
   偏移量不变 ⇒ 干扰项对应的错误模式（符号错、优先级错…）原样保留，
   而正确项恒等于新真值 —— 答案字母天然不变；
4. `verify_variant()` 独立重算一遍做终检：真值必须唯一命中选项/答案，且选项无重复。

**解不出真值就返回 ok=False**，由调用方退回题库换题或走错题复习。
宁可不出变式，也不出无解题 —— 无解题会让"变式验证"这个环节变成反作用。

LLM 出题是另一条路（04 决策：LLM 初稿 + 人工校验），本模块是确定性兜底。
"""

from __future__ import annotations

import ast
import math
import operator
import random
import re
from dataclasses import dataclass
from fractions import Fraction

from app.domain.schemas import Question

_NUM = re.compile(r"(?<![\w.])(-?\d+)(?![\w.])")
_MATH = re.compile(r"\$([^$]+)\$")

# 支持的二元/一元运算符；刻意保守 —— 求值器只服务于"验证变式题有解"，
# 不做通用计算器，任何超出范围的表达式一律判为"解不出"→ 拒绝生成。
_BIN = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_MAX_POW = 12  # 指数/底数绝对值上限：2^40 之类会让分数爆炸且无教学意义
# 偏移量取值范围。旧实现只有 1-5 五档，实测同一道题 seed=1/3/4 全部撞成
# `$-5-7=?$` —— 变式题之间自己先重复了。放宽到 2-9：既避开 ±1（与原题太像，
# 学生感觉不到变化），又不会把 $-3-5$ 推到 $-30-50$ 这种脱离教学实际的值。
_DELTA_MIN, _DELTA_MAX = 2, 9


@dataclass
class VariantResult:
    question: Question
    seed: int
    ok: bool          # 是否是"有解的变式"（含答案自洽校验，见 verify_variant）
    error: str | None = None


# --------------------------------------------------------------------------
# 安全算式求值：把 $...$ 里的算式解成真值
# --------------------------------------------------------------------------


def _eval_node(node: ast.AST) -> Fraction:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError("非数值常量")
        return Fraction(node.value).limit_denominator(10**6)
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        a, b = _eval_node(node.left), _eval_node(node.right)
        if b == 0:
            raise ZeroDivisionError
        if isinstance(node.op, ast.Pow):
            if abs(b.denominator) != 1 or abs(b) > _MAX_POW or abs(a) > _MAX_POW:
                raise ValueError("幂次超出范围")
            if a.denominator != 1 and b > 0:
                # 分数次幂（如 4^(1/2)）不引入，避免开方分支
                raise ValueError("不支持分数次幂")
            return Fraction(_BIN[ast.Pow](Fraction(a), Fraction(b)))
        return _BIN[type(node.op)](a, b)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval_node(node.operand))
    raise ValueError("不支持的语法节点")


def latex_to_py(expr: str) -> str | None:
    """LaTeX 算式 → Python 表达式；含变量或不支持的命令返回 None。"""
    s = expr.strip()
    if not s:
        return None
    # 变量一律不解：平移后的方程需要解方程，那是另一套逻辑，
    # 这里宁可判"解不出"退回题库，也不要给出一个可能错的答案。
    stripped = re.sub(r"\\[dt]?frac|\\times|\\cdot|\\div|\\pi", "", s)
    if re.search(r"[a-zA-Z]", stripped):
        return None
    s = s.replace("\\times", "*").replace("\\cdot", "*").replace("\\div", "/")
    s = re.sub(r"\\pi", "3.141592653589793", s)
    for _ in range(8):  # 支持嵌套 \frac
        new = re.sub(r"\\[dt]?frac\{([^{}]+)\}\{([^{}]+)\}", r"((\1)/(\2))", s)
        if new == s:
            break
        s = new
    for cmd in ("\\left", "\\right", "\\!", "\\,", "\\;", "\\ "):
        s = s.replace(cmd, "")
    s = s.replace("\\%", "").replace("%", "")
    s = s.replace("^", "**").replace("{", "(").replace("}", ")")
    if re.search(r"\\[a-zA-Z]+", s):
        return None
    if not re.fullmatch(r"[0-9+\-*/(). ]+", s):
        return None
    return s or None


def solve_math(content: str) -> Fraction | None:
    """解出题干里 `... = ?` 那一段算式的真值；解不出返回 None。"""
    for m in _MATH.finditer(content):
        seg = m.group(1)
        if "=" not in seg:
            continue
        left, right = seg.split("=", 1)
        if right.strip() not in ("?", "？", ""):
            continue
        py = latex_to_py(left)
        if not py:
            return None
        try:
            return _eval_node(ast.parse(py, mode="eval"))
        except Exception:
            return None
    return None


# --------------------------------------------------------------------------
# 数值解析与格式化
# --------------------------------------------------------------------------

_FRAC_RE = re.compile(r"^(-?)\\([dt]?)frac\{(.+)\}\{(.+)\}$")
_INT_RE = re.compile(r"^-?\d+$")
_DEC_RE = re.compile(r"^(-?\d+)\.(\d+)$")


def parse_number(text: str) -> Fraction | None:
    """从选项/答案文本里取数值：`$-8$`、`$\frac{1}{2}$`、`8`、`2.5` → 值。

    含 `±3`、`5 或 -5`、`以上` 等非单一数值形态 → None（不可机械校验 → 不生成变式）。
    """
    t = str(text).strip()
    if t.startswith("$") and t.endswith("$"):
        t = t[1:-1].strip()
    if _INT_RE.match(t):
        return Fraction(int(t))
    m = _DEC_RE.match(t)
    if m:
        return Fraction(f"{m.group(1)}.{m.group(2)}")
    m = _FRAC_RE.match(t)
    if m:
        sign, macro, num, den = m.groups()
        n, d = parse_number(num), parse_number(den)
        if n is None or d is None or d == 0:
            return None
        v = n / d
        return -v if sign == "-" else v
    return None


def format_like(template: str, value: Fraction) -> str | None:
    """按原选项的书写形态渲染新值（同为整数 / 同为分数 / 同为小数、保留 `$` 与正负号）。

    形态无法复刻（如原选项是 `±3`）→ None，调用方据此拒绝生成。
    """
    t = str(template).strip()
    wrap = ""
    if t.startswith("$") and t.endswith("$"):
        wrap, t = "$", t[1:-1].strip()
    neg = "-" if value < 0 else ""
    av = abs(value)

    m = _FRAC_RE.match(t)
    if m:
        sign, macro, _, _ = m.groups()
        if av.denominator == 1:
            inner = f"{neg}{av.numerator}"  # 结果是整数就别硬凑分数
        else:
            inner = f"{neg}\\{macro}frac{{{av.numerator}}}{{{av.denominator}}}"
        return f"{wrap}{inner}{wrap}"

    if _INT_RE.match(t):
        if av.denominator != 1:
            return None  # 形态不符（原来整数、现在分数）→ 拒绝，不硬转
        return f"{wrap}{neg}{av.numerator}{wrap}"

    m = _DEC_RE.match(t)
    if m:
        digits = len(m.group(2))
        if av.denominator == 1:
            return f"{wrap}{neg}{av.numerator}.{'0' * digits}{wrap}"
        q = Fraction(av).limit_denominator(10**digits)
        if q.denominator == 1:
            return f"{wrap}{neg}{q.numerator}.{'0' * digits}{wrap}"
        return f"{wrap}{neg}{float(q):.{digits}f}{wrap}"

    return None


def _is_unsimplified(text: str) -> bool:
    """单个分数是否未约分（分子分母有 >1 的公因子），如 $\\frac{2}{4}$。"""
    m = _FRAC_RE.match(text)
    if not m:
        return False
    sign, _, num, den = m.groups()
    n, d = parse_number(num), parse_number(den)
    if n is None or d is None or d == 0:
        return False
    n, d = abs(n), abs(d)
    if n.denominator != 1 or d.denominator != 1:
        return False  # 分子分母本身不是整数，谈不上约分
    return math.gcd(int(n), int(d)) > 1


def _has_unsimplified_fraction(text: str) -> bool:
    """文本里是否含未约分分数（$\\frac{2}{4}$）。

    判据是"分子分母有 >1 的公因子"，不是"分母≠1" —— 后者会把 $\\frac{1}{2}$
    这类最常见的正确写法全部误判成未约分。
    """
    for m in _MATH.finditer(text):
        for fm in re.finditer(r"\\[dt]?frac\{[^{}]*\}\{[^{}]*\}", m.group(1)):
            if _is_unsimplified(fm.group(0)):
                return True
    return False


# --------------------------------------------------------------------------
# 平移（仅用于题干）
# --------------------------------------------------------------------------


def _shift_numbers(text: str, delta: int) -> str:
    """题干中所有整数 +delta（0 与负号规则保持）。"""

    def repl(m):
        v = int(m.group(1))
        if v == 0:
            return "0"
        return str(v + delta if v > 0 else v - delta)

    return _NUM.sub(repl, text)


def _answer_index(q: Question) -> int | None:
    """choice/multi 的答案落在第几个选项；形态不认识返回 None。"""
    a = q.answer
    if isinstance(a, bool):
        return None
    if isinstance(a, int):
        return a if 0 <= a < len(q.options or []) else None
    if isinstance(a, str) and len(a.strip()) == 1 and a.strip().upper() in "ABCDEFGH":
        i = ord(a.strip().upper()) - 65
        return i if 0 <= i < len(q.options or []) else None
    return None


# --------------------------------------------------------------------------
# 生成
# --------------------------------------------------------------------------


def generate_variant(q: Question, seed: int, delta: int | None = None) -> VariantResult:
    """生成一道**有解**的变式题（确定性：同 seed 同结果）。

    delta 未指定时由 seed 派生（2-9，保证非 0 变化且不同 seed 撞车概率低）。
    任何一步无法保证答案自洽 → ok=False，绝不返回无解题。
    """
    rng = random.Random(seed)
    d = delta if delta is not None else rng.randint(_DELTA_MIN, _DELTA_MAX)

    def reject(reason: str) -> VariantResult:
        return VariantResult(question=q, seed=seed, ok=False, error=reason)

    # --- 前置校验：原题自身必须能被本模块验证，否则没资格改它 ---
    old_true = solve_math(q.content)
    if old_true is None:
        return reject("原题题干不是可机械求解的算式（如含变量/方程/绝对值分类）")
    if _has_unsimplified_fraction(q.content):
        return reject("题干含未约分分数，平移会破坏结构")

    new_content = _shift_numbers(q.content, d)
    if new_content == q.content:
        return reject("题干无可平移的数字")

    new_true = solve_math(new_content)
    if new_true is None:
        return reject("变式题干求解失败")
    if new_true == old_true:
        return reject("平移后真值未变，等于原题")
    if _has_unsimplified_fraction(new_content):
        return reject("变式题干含未约分分数")

    try:
        if q.type in ("choice", "multi"):
            if q.type == "multi":
                return reject("多选题正确答案不止一个，偏移量法不适用")
            ai = _answer_index(q)
            if ai is None or not q.options:
                return reject("无法定位正确选项")
            old_opt_vals = [parse_number(o) for o in q.options]
            if any(v is None for v in old_opt_vals):
                return reject("选项含非单一数值形态（如 ±3 / '5 或 -3'），无法机械校验")
            old_ans_val = old_opt_vals[ai]
            if old_ans_val != old_true:
                return reject("原题自身不自洽（选项答案值 ≠ 题干真值），不基于它生成变式")

            # 整题重算：保留各选项相对真值的偏移 → 干扰项的错误模式原样保留
            new_opts: list[str] = []
            for tpl, ov in zip(q.options, old_opt_vals):
                rendered = format_like(tpl, new_true + (ov - old_true))
                if rendered is None:
                    return reject("新选项值无法按原形态书写")
                new_opts.append(rendered)
            answer = chr(65 + ai)  # 偏移量法下正确项位置不变
            new_answer: str | int | list[str] = answer

        elif q.type == "blank":
            old_ans_val = parse_number(str(q.answer))
            if old_ans_val is None:
                return reject("填空题答案不是单一数值")
            if old_ans_val != old_true:
                return reject("原题自身不自洽（答案 ≠ 题干真值）")
            rendered = format_like(str(q.answer), new_true)
            if rendered is None:
                return reject("新答案无法按原形态书写")
            new_opts = q.options or []
            new_answer = rendered

        else:  # open（解答题）：答案通常是过程/文本，无唯一真值可校验
            return reject("解答题答案不可机械校验")

        variant = Question(
            id=f"{q.id}v{seed}",
            type=q.type,
            content=new_content,
            difficulty=min(1.0, max(0.0, q.difficulty + rng.uniform(-0.05, 0.05))),
            options=new_opts if q.type in ("choice", "multi") else q.options,
            answer=new_answer,
            step_node_map=q.step_node_map,
        )
    except Exception as e:  # schema 校验失败等
        return reject(f"构造变式失败：{e}")

    ok, why = verify_variant(variant)
    if not ok:
        return reject(f"自洽校验未通过：{why}")
    return VariantResult(question=variant, seed=seed, ok=True)


# --------------------------------------------------------------------------
# 独立校验（不信任生成过程，只看产物）
# --------------------------------------------------------------------------


def verify_variant(q: Question) -> tuple[bool, str]:
    """校验一道题"有解"：答案值 == 题干真值，且选项无重复值。

    这是 P1-8 要求的"答案自洽率"口径 —— 只查 schema 的可用率给人虚假信心。
    """
    true_val = solve_math(q.content)
    if true_val is None:
        return False, "题干求解失败"

    if q.type in ("choice", "multi"):
        ai = _answer_index(q)
        if ai is None or not q.options:
            return False, "无法定位正确选项"
        vals = [parse_number(o) for o in q.options]
        if any(v is None for v in vals):
            return False, "选项含不可机械校验的形态"
        if len(set(vals)) != len(vals):
            return False, "选项出现重复值（题目有多个正确项）"
        if vals[ai] != true_val:
            return False, f"答案值 {vals[ai]} ≠ 真值 {true_val}"
        return True, ""

    if q.type == "blank":
        av = parse_number(str(q.answer))
        if av is None:
            return False, "答案不是单一数值"
        if av != true_val:
            return False, f"答案 {av} ≠ 真值 {true_val}"
        return True, ""

    return False, "解答题无唯一真值，无法机械校验"


def self_consistency_rate(results: list[VariantResult]) -> tuple[int, int]:
    """答案自洽率 = (生成成功数) / (尝试数)。ok=True 已含 verify_variant 通过。"""
    if not results:
        return 0, 0
    return sum(1 for r in results if r.ok), len(results)


def generate_batch(
    questions: list[Question], seeds: list[int]
) -> list[VariantResult]:
    """批量生成。seeds 按题配对：长度相等则一一对应，长度为 1 则广播到每道题。

    旧实现是 `zip(questions, seeds)` —— 两边长度不等时静默截断
    （P4-10：文档里的 235/235 在任何代码路径下都产生不了，真实只有 47）。
    """
    if not seeds:
        raise ValueError("seeds 不能为空")
    if len(seeds) == 1:
        return [generate_variant(q, seeds[0]) for q in questions]
    if len(seeds) != len(questions):
        raise ValueError(
            f"seeds 长度 {len(seeds)} 与题目数 {len(questions)} 不匹配；"
            "要每题都生成，请传单个 seed（会广播）"
        )
    return [generate_variant(q, s) for q, s in zip(questions, seeds)]


def usability_rate(results: list[VariantResult]) -> float:
    """变式可用率。

    口径已在 P1-8 修正：ok=True 现在意味着"答案自洽（有解）"，
    不再只是"schema 校验通过"。覆盖不到的题（解答题、含变量的方程）计入分母，
    因此这个数会明显低于旧口径 —— 那是真实的生成能力，不是回归。
    """
    ok, total = self_consistency_rate(results)
    return ok / total if total else 0.0
