"""
Test suite for environment management functionality with sequential matching.

Tests the integration of environment management with pytest plugin.
Devices are matched sequentially based on attribute requirements, not by name.
"""
import logging

import pytest
from resources.mapper import ENV_TEMPLATES

class TestDemoExecutionFail:
    """单台设备覆盖单个硬件类型"""
    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    @pytest.mark.remote_run
    def test_single_device_fail(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device execute =========")
        logger.tc_step("test tc_step1 tc_step2 tc_step3 tc_step4 tc_step5 tc_step6 tc_step7 tc_step8")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)

        cmd8 = "cat /etc/hostname"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device finished =========")
        assert False

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    def test_single_error_case_fail(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_error_case finished =========")
        assert False

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    def test_single_device_local_fail_br(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device_local execute =========")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)
        cmd4 = "pwd"
        environment.sendcmd(cmd4)

        cmd8 = "cat /etc/os-release"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device_local finished =========")
        assert True


class TestDemoExecutionSucc:
    """单台设备覆盖单个硬件类型"""
    @pytest.mark.case_info(level="P0", type="test")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    @pytest.mark.remote_run
    def test_single_device(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device execute =========")
        logger.tc_step("test tc_step1 tc_step2 tc_step3 tc_step4 tc_step5 tc_step6 tc_step7 tc_step8")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)

        cmd8 = "cat /etc/hostname"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device finished =========")
        assert True

    @pytest.mark.case_info(level="P1")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    def test_single_error_case(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_error_case finished =========")
        assert True

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_single_type"])
    def test_single_device_local(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device_local execute =========")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)
        cmd4 = "pwd"
        environment.sendcmd(cmd4)

        cmd8 = "cat /etc/os-release"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device_local finished =========")
        assert True


class TestDemoExecutionMultiNodes:
    """单台设备覆盖单个硬件类型"""
    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_nodes_type"])
    @pytest.mark.remote_run
    def test_single_device(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device execute =========")
        logger.tc_step("test tc_step1 tc_step2 tc_step3 tc_step4 tc_step5 tc_step6 tc_step7 tc_step8")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)

        cmd8 = "cat /etc/hostname"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device finished =========")
        assert True

    @pytest.mark.case_info(level="P2", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_nodes_type"])
    def test_single_error_case(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_error_case finished =========")
        assert True

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_nodes_type"])
    def test_single_device_local(self, environment, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device_local execute =========")
        cmd3 = "ls -l"
        environment.sendcmd(cmd3)
        cmd4 = "pwd"
        environment.sendcmd(cmd4)

        cmd8 = "cat /etc/os-release"
        environment.sendcmd(cmd8)
        logger.info("======== test_single_device_local finished =========")
        assert True


class TestDemoExecutionMultiDevice:
    """单台设备覆盖单个硬件类型"""
    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_type"])
    @pytest.mark.remote_run
    def test_single_multi_device(self, environments, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device execute =========")
        logger.tc_step("test tc_step1 tc_step2 tc_step3 tc_step4 tc_step5 tc_step6 tc_step7 tc_step8")
        cmd3 = "cat /etc/hostname"
        environments["device1"].sendcmd(cmd3)

        cmd8 = "cat /etc/hostname"
        environments["device2"].sendcmd(cmd8)
        logger.info("======== test_single_device finished =========")
        assert True

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_type"])
    def test_single_error_case_multi(self, environments, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_error_case finished =========")
        assert True

    @pytest.mark.case_info(level="P0", type="Functional")
    @pytest.mark.env(template=ENV_TEMPLATES["self_test_multi_type"])
    def test_single_multi_device_local(self, environments, logger):
        """单台设备不用指定env的name，使用environment直接执行"""
        logger.info("======== test_single_device_local execute =========")
        cmd3 = "ls -l"
        environments["device1"].sendcmd(cmd3)
        cmd4 = "pwd"
        environments["device1"].sendcmd(cmd4)

        cmd8 = "cat /etc/os-release"
        environments["device2"].sendcmd(cmd8)
        logger.info("======== test_single_device_local finished =========")
        assert True
