/**
 * presentation-v3 启动入口：把新版界面登记为可选根组件。
 * 必须在 bootstrapAcuV2() 之前调用——之后首次打开面板时 mount 会按偏好挑选根组件。
 */
import { registerNextUiRoot_ACU } from '../../presentation-v2/bootstrap/ui-generation';
import App from '../App.vue';

export function installAcuV3(): void {
  registerNextUiRoot_ACU(App);
}
