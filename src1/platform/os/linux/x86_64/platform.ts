import type { IPlatform } from "../../../IPlatform.js";
import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { emitSyscall_X86_64 } from "./syscalls.js";
import { emitMemoryAllocate_X86_64, emitMemoryFree_X86_64 } from "./memory.js";
import { emitLowLevelRuntime_X86_64, emitGlobalDefinitions_X86_64 } from "./runtime.js";

// X86_64LinuxPlatform 实现了 IPlatform 接口，并封装了 x86_64 架构在 Linux 操作系统上的特性。
// 该类将通过组合其他模块来提供完整的平台功能。
export class X86_64LinuxPlatform implements IPlatform {
    constructor() {
    }

    getTargetTriple(): string {
        return "x86_64-unknown-linux-gnu"; // 标准 Linux x86-64 三元组
    }

    getDataLayout(): string {
        return "e-m:e-i64:64-f80:128-n8:16:32:64-S128"; // 常见 x86-64 Linux 数据布局
    }

    // 获取指针大小 (比特)
    getPointerSizeInBits(): number {
        return 64; // x86-64 是 64 位架构
    }

    // 获取指针对齐方式 (字节)
    getPointerAlignmentInBytes(): number {
        return 8; // 指针在 x86-64 上通常是 8 字节对齐
    }

    // 获取操作系统标识符
    getOsIdentifier(): string {
        return "linux";
    }

    // 获取架构标识符
    getArchIdentifier(): string {
        return "x86_64";
    }

    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
        return emitSyscall_X86_64(this, generator, callNum, args);
    }


    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue {
        return emitMemoryAllocate_X86_64(this, generator, size);
    }

    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void {
        emitMemoryFree_X86_64(this, generator, addr, size);
    }

    emitLowLevelRuntime(generator: IRGenerator): void {
        emitLowLevelRuntime_X86_64(this, generator);
    }

    emitGlobalDefinitions(generator: IRGenerator): void {
        emitGlobalDefinitions_X86_64(generator);
    }
}
