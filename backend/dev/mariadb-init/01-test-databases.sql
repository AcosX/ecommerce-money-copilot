-- 仅开发容器：允许应用账号创建/删除测试库 emc_test_*（pytest 每次运行建独立测试库）。
GRANT ALL PRIVILEGES ON `emc\_test\_%`.* TO 'emc'@'%';
