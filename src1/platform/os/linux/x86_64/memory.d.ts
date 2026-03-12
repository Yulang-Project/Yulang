import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { X86_64LinuxPlatform } from "./platform.js";
export declare function emitMemoryAllocate_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, size: IRValue): IRValue;
export declare function emitMemoryFree_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, addr: IRValue, size: IRValue): void;
//# sourceMappingURL=memory.d.ts.map