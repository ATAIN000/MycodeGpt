<template>
  <a-layout class="full-height">
    <a-layout-sider v-model:collapsed="collapsed" theme="light" width="60">
      <a-menu v-model:selectedKeys="selectedKeys">
        <a-menu-item key="ModelTable" @click="navigateTo('/ModelTable')">
          <RobotOutlined/>
        </a-menu-item>
        <a-menu-item key="SessionWithBigData" @click="navigateTo('/Session')">
          <CodeOutlined/>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <router-view></router-view>
    </a-layout>
  </a-layout>
</template>

<script>
import {ref, watch} from 'vue';
import {useRouter, useRoute} from 'vue-router';
import {Layout, Menu} from 'ant-design-vue';
import {
  RobotOutlined, // 新增图标用于AI模型管理
  ProjectOutlined, // 新增图标用于项目管理
  CodeOutlined, // 新增图标用于AI代码
  LineChartOutlined // 保留原有图标用于多数据库AI分析
} from '@ant-design/icons-vue';

export default {
  components: {
    Layout,
    Menu,
    RobotOutlined,
    ProjectOutlined,
    CodeOutlined,
    LineChartOutlined
  },
  setup() {
    const collapsed = ref(false);
    const router = useRouter();
    const route = useRoute();
    const selectedKeys = ref([route.path.split('/').pop()]);

    const navigateTo = (route) => {
      router.push(route);
      selectedKeys.value = [route.split('/').pop()];
    };

    // 监听路由变化，更新选中的菜单项
    watch(
        () => route.path,
        (newPath) => {
          selectedKeys.value = [newPath.split('/').pop()];
        }
    );

    return {
      collapsed,
      selectedKeys,
      navigateTo,
    };
  }
};
</script>
