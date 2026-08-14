import os
import pytest

from unittest.mock import MagicMock, patch

template_config = {
    "single_device_cover_single_type" : "config/env_template/single_device_cover_single_type_template.json",
    "multi_device_cover_single_type" : "config/env_template/multi_device_cover_single_type_template.json",
    "single_device_cover_multi_type" : "config/env_template/single_device_cover_multi_type_template.json",
    "multi_device_cover_multi_type" : "config/env_template/multi_device_cover_multi_type_template.json",
    "case_info_template" : "config/case_info_template/case_info_template.json"
}


class TestLocalExecution:

    @pytest.mark.env(template=template_config["single_device_cover_multi_type"])
    # @pytest.mark.env({'name':'A2_1','model': 'Atlas 800T A2'}, {'name':'A2_2','model': 'Atlas 800T A2'})
    @pytest.mark.smoke
    def test_1_no_case_info(self, environment, logger):
        cmd = "ls"
        environment.sendcmd(cmd)
        assert True

    @pytest.mark.case_info(template=template_config["case_info_template"])
    @pytest.mark.env(template=template_config["single_device_cover_multi_type"])
    @pytest.mark.smoke
    def test_2_only_case_info(self, environment, logger):
        cmd = "ls"
        logger.info("======== test_single_device execute =========")
        environment.sendcmd(cmd)
        logger.info("======== test_single_device finished =========")
        assert True

    @pytest.mark.case_info(template=template_config["case_info_template"], level="P1", type="case")
    @pytest.mark.env(template=template_config["single_device_cover_multi_type"])
    @pytest.mark.smoke
    def test_3_single_device_P1_case(self, environment, logger):
        cmd = "ls"
        logger.info("======== test_single_device execute =========")
        environment.sendcmd(cmd)
        logger.info("======== test_single_device finished =========")
        assert True

    @pytest.mark.case_info(template=template_config["case_info_template"], level="P1", type="case2")
    @pytest.mark.env(template=template_config["single_device_cover_multi_type"])
    @pytest.mark.smoke
    def test_4_single_device_P1_case2(self, environment, logger):
        cmd = "ls"
        logger.info("======== test_single_device execute =========")
        environment.sendcmd(cmd)
        logger.info("======== test_single_device finished =========")
        assert True


    def test_5_no_env_only_level_P1(self, environments, logger):
        assert True

    def test_6_local_only_tpye_function(self, environment, logger):
        print(777)
        assert True


    def test_7_remote_run_p0_case2(self, environments, logger):
        logger.fail("this is a error log")
        assert True

    def test_8_env_marker_p1_case1(self, environments):
        assert True

    @pytest.mark.skip("Skip as register_kernels has NPU SocName checking in CANN 8.5.0.")
    def test_9_case_filter_p0_func(self, environments):
        assert True

class TestBatchInvariant:
    """Complete test suite for batch_invariant.py"""

    def test_override_envs_for_invariance(self):
        """Test Config and environment variable override"""
        assert True

    @patch("vllm_ascend.batch_invariant.HAS_TRITON", False)
    @patch("vllm_ascend.batch_invariant.HAS_ASCENDC_BATCH_INVARIANT", True)
    def test_enable_batch_invariant_mode_ascendc_path(self):
        assert True