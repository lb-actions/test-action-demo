#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
配置模板映射文件

此模块定义了模板名称和具体模板文件的映射关系。
在用例中引用模板名称即可,无需关心具体的文件路径。
"""

from typing import Dict

# 环境模板配置映射
ENV_TEMPLATES: Dict[str, str] = {
    "single_device_cover_single_type": "resources/device_desc/template/single_device_cover_single_type_template.json",
    "multi_device_cover_single_type": "resources/device_desc/template/multi_device_cover_single_type_template.json",
    "single_device_cover_multi_type": "resources/device_desc/template/single_device_cover_multi_type_template.json",
    "multi_device_cover_multi_type": "resources/device_desc/template/multi_device_cover_multi_type_template.json",
    "mindcse_cluster_env": "resources/device_desc/mindcse_cluster_template.json",
    "mindie_demo_env": "resources/device_desc/mindie/mindie_demo_env.json",
    "mindie_k8s_env": "resources/device_desc/mindie/mindie_k8s_env.json",
    "mindspeed_single_device_cover_single_type": "resources/device_desc/mindspeed_single_device_env.json",
    "mindstudio_single_device_cover_single_type": "resources/device_desc/mindstudio_single_device_env.json",
    "cann_single_device_cover_single_type": "resources/device_desc/cann_single_device_env.json",
    "self_test_single_type": "resources/device_desc/self_test_device_env.json",
    "self_test_multi_type": "resources/device_desc/self_test_multi_device_env.json",
    "self_test_multi_nodes_type": "resources/device_desc/self_test_multi_nodes_env.json"
}

# 用例信息模板配置映射
CASE_TEMPLATES: Dict[str, str] = {
    "case_info_template": "resources/case_desc/case_info_template/case_info_template.json",
    "mindcse_case_info": "resources/case_desc/case_info_template/mindcse_case_info.json",
    "mindie_demo_case_info": "resources/case_desc/case_info_template/mindie_demo_case_info.json",
}

# 环境变量映射配置样例比如环境上配置的MINDIE的安装路径的环境变量为 MINDIE_INSTALL_PATH = "/usr/local/Ascend/mindie"
# 统一在此处声明环境变量映射关系，方便后续使用
MINDIE_ENV_VARS: Dict[str, str] = {
    "INSTALL_PATH": "MINDIE_INSTALL_PATH",
    "CANN_PATH": "MINDIE_CANN_PATH",
}
INDEXSDK_ENV_VARS: Dict[str, str] = {
    "INSTALL_PATH": "MXINDEX_INSTALL_PATH",
    "CANN_PATH": "ASCEND_HOME_PATH",
}
# 向后兼容的别名(保持旧代码可用)
env_desc = ENV_TEMPLATES
case_desc = CASE_TEMPLATES
mindie_env_vars = MINDIE_ENV_VARS
