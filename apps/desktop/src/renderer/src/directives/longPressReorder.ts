import type { ObjectDirective } from "vue";
import {
  bindLongPressReorder,
  type LongPressReorderOptions
} from "../utils/longPressReorder";

const controllers = new WeakMap<
  HTMLElement,
  { options: LongPressReorderOptions; dispose: () => void }
>();

export const vLongPressReorder: ObjectDirective<
  HTMLElement,
  LongPressReorderOptions
> = {
  mounted(element, binding) {
    const controller = {
      options: binding.value,
      dispose: () => {}
    };
    controller.dispose = bindLongPressReorder(
      element,
      () => controller.options
    );
    controllers.set(element, controller);
  },
  updated(element, binding) {
    const controller = controllers.get(element);
    if (controller) controller.options = binding.value;
  },
  beforeUnmount(element) {
    controllers.get(element)?.dispose();
    controllers.delete(element);
  }
};
