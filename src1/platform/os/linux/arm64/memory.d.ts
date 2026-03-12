import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { ARM64LinuxPlatform } from "./platform.js";
export declare function emitMemoryAllocate_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, size: IRValue): IRValue;
export declare function emitMemoryFree_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, addr: IRValue, size: IRValue): void;
//# sourceMappingURL=memory.d.ts.map