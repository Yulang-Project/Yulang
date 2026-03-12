import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { X86_64LinuxPlatform } from "./platform.js";
export declare function emitSyscallInlineASM_X86_64(generator: IRGenerator, callNum: string, args: string[]): string;
export declare function emitSyscall_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue;
//# sourceMappingURL=syscalls.d.ts.map