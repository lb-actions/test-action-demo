"""
标准 unittest 用例：JSON 参数解析

自包含，不依赖项目其他模块。
被测函数内联在文件中，演示标准 unittest 结构。

运行方式：
    cd test-action-demo
    python -m unittest tests.unit-test.test_process_json_param -v
"""
import json
import unittest


def process_json_param(param):
    """
    解析可能是简化格式的 JSON 字符串。

    支持两种格式：
    - 标准 JSON: {"key": "value"}
    - 简化格式: {key: value} 或 {key:value,key:value}

    Args:
        param: 输入字符串

    Returns:
        dict: 解析后的字典，解析失败返回空字典
    """
    try:
        if param and param.find('"') == -1:
            inner = param.strip("{}")
            pairs = [p.strip() for p in inner.split(",")]
            json_pairs = []
            for pair in pairs:
                if ":" in pair:
                    k, v = pair.split(":", 1)
                    json_pairs.append(f'"{k.strip()}":"{v.strip()}"')
            tmp = "{" + ",".join(json_pairs) + "}"
            return json.loads(tmp)
        else:
            return json.loads(param)
    except Exception:
        return {}


class TestProcessJsonParamStandard(unittest.TestCase):
    """标准 JSON 格式解析"""

    def test_standard_json_with_quotes(self):
        param = '{"apig_code": "xxx", "apig_key": "yyy"}'
        result = process_json_param(param)
        self.assertEqual(result["apig_code"], "xxx")
        self.assertEqual(result["apig_key"], "yyy")

    def test_standard_json_single_key(self):
        param = '{"apig_code": "code123"}'
        result = process_json_param(param)
        self.assertEqual(result, {"apig_code": "code123"})

    def test_standard_json_empty_string_values(self):
        param = '{"apig_code": "", "apig_key": ""}'
        result = process_json_param(param)
        self.assertEqual(result, {"apig_code": "", "apig_key": ""})

    def test_standard_json_with_spaces(self):
        param = '{  "apig_code" : "val1" , "apig_key" : "val2"  }'
        result = process_json_param(param)
        self.assertEqual(result["apig_code"], "val1")
        self.assertEqual(result["apig_key"], "val2")


class TestProcessJsonParamSimplified(unittest.TestCase):
    """简化格式（无引号）解析"""

    def test_simplified_format_no_spaces(self):
        param = "{apig_code:xxx,apig_key:yyy}"
        result = process_json_param(param)
        self.assertEqual(result["apig_code"], "xxx")
        self.assertEqual(result["apig_key"], "yyy")

    def test_simplified_format_with_spaces(self):
        param = "{ apig_code : xxx, apig_key : yyy }"
        result = process_json_param(param)
        self.assertEqual(result, {"apig_code": "xxx", "apig_key": "yyy"})

    def test_simplified_format_single_key(self):
        param = "{apig_code:code123}"
        result = process_json_param(param)
        self.assertEqual(result, {"apig_code": "code123"})


class TestProcessJsonParamEdgeCases(unittest.TestCase):
    """边界与异常场景"""

    def test_empty_string_returns_empty_dict(self):
        self.assertEqual(process_json_param(""), {})

    def test_invalid_json_returns_empty_dict(self):
        self.assertEqual(process_json_param("not a json string"), {})

    def test_none_input_returns_empty_dict(self):
        self.assertEqual(process_json_param(None), {})

    def test_malformed_json_returns_empty_dict(self):
        """含引号但 JSON 格式错误时返回空字典"""
        self.assertEqual(process_json_param('{"broken":}'), {})

    def test_unterminated_json_returns_empty_dict(self):
        """JSON 未闭合时返回空字典"""
        self.assertEqual(process_json_param('{"key": "val"'), {})


class TestProcessJsonParamMixed(unittest.TestCase):
    """混合与特殊值场景"""

    def test_simplified_value_with_colon(self):
        """值中包含冒号时，split(":", 1) 只切第一个冒号"""
        param = "{apig_code:val:ue,apig_key:yyy}"
        result = process_json_param(param)
        self.assertEqual(result["apig_code"], "val:ue")

    def test_standard_json_numeric_string_values(self):
        param = '{"apig_code": "123", "apig_key": "456"}'
        result = process_json_param(param)
        self.assertEqual(result["apig_code"], "123")


if __name__ == "__main__":
    unittest.main()
