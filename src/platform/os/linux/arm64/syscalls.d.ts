import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { ARM64LinuxPlatform } from "./platform.js";
export declare function emitSyscallInlineASM_ARM64(generator: IRGenerator, callNum: string, args: string[]): string;
export declare function emitSyscall_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue;
//# sourceMappingURL=syscalls.d.ts.map