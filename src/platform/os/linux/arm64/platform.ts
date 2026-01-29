import type { IPlatform } from "../../../IPlatform.js";
import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import { emitSyscall_ARM64 } from "./syscalls.js";
import { emitMemoryAllocate_ARM64, emitMemoryFree_ARM64 } from "./memory.js";
import { emitLowLevelRuntime_ARM64, emitGlobalDefinitions_ARM64 } from "./runtime.js";

// ARM64LinuxPlatform 实现了 IPlatform 接口，并封装了 ARM64 架构在 Linux 操作系统上的特性。
// 该类将通过组合其他模块来提供完整的平台功能。
export class ARM64LinuxPlatform implements IPlatform {
    constructor() {
    }

    getTargetTriple(): string {
        return "aarch64-unknown-linux-gnu"; // 标准 Linux ARM64 三元组
    }

    getDataLayout(): string {
        return "e-m:e-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128"; // 常见 ARM64 Linux 数据布局
    }

    // 获取指针大小 (比特)
    getPointerSizeInBits(): number {
        return 64; // ARM64 是 64 位架构
    }

    // 获取指针对齐方式 (字节)
    getPointerAlignmentInBytes(): number {
        return 8; // 指针在 ARM64 上通常是 8 字节对齐
    }

    // 获取操作系统标识符
    getOsIdentifier(): string {
        return "linux";
    }

    // 获取架构标识符
    getArchIdentifier(): string {
        return "arm64";
    }

    // 以下方法将由其他模块提供，这里只是占位符
    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
        return emitSyscall_ARM64(this, generator, callNum, args);
    }

    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue {
        return emitMemoryAllocate_ARM64(this, generator, size);
    }

    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void {
        emitMemoryFree_ARM64(this, generator, addr, size);
    }

    emitLowLevelRuntime(generator: IRGenerator): void {
        emitLowLevelRuntime_ARM64(this, generator);
    }

    emitGlobalDefinitions(generator: IRGenerator): void {
        emitGlobalDefinitions_ARM64(generator);
    }
}
