import { IRGenerator } from "../../../../generator/ir_generator.js";
import { ARM64LinuxPlatform } from "./platform.js";
import { emitSyscall_ARM64, emitSyscallInlineASM_ARM64 } from "./syscalls.js"; // For brk in emitLowLevelRuntime
import { emitMemoryAllocate_ARM64 } from "./memory.js"; // For malloc

// Emits low-level runtime functions for ARM64 Linux
export function emitLowLevelRuntime_ARM64(platform: ARM64LinuxPlatform, generator: IRGenerator): void {
    // Internal heap initialization function
    generator.emit(`define internal void @__heap_init_internal() {`, false);
    generator.indentLevel++;
    const initFlagHeap = generator.llvmHelper.getNewTempVar();
    generator.emit(`${initFlagHeap} = load i1, i1* @__heap_initialized, align 1`);
    const doneLbl = generator.getNewLabel('heap.init.done');
    const doLbl = generator.getNewLabel('heap.init.do');
    generator.emit(`br i1 ${initFlagHeap}, label %${doneLbl}, label %${doLbl}`);
    generator.emit(`${doLbl}:`, false);
    generator.indentLevel++;
    
    // Perform brk syscall (12) to get current program break
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: '0', type: 'i64' }]; // Argument 0 for brk means get current break
    const brkSyscallResult = emitSyscall_ARM64(platform, generator, brkCallNum, brkArgs);
    const currentBrkValue = brkSyscallResult.value;
    
    const currentBrkPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${currentBrkPtr} = inttoptr i64 ${currentBrkValue} to i8*`);
    generator.emit(`store i8* ${currentBrkPtr}, i8** @__heap_base, align 8`);
    generator.emit(`store i8* ${currentBrkPtr}, i8** @__heap_brk, align 8`);
    generator.emit(`store i1 true, i1* @__heap_initialized, align 1`);
    generator.emit(`br label %${doneLbl}`);
    generator.indentLevel--;
    generator.emit(`${doneLbl}:`, false);
    generator.emit(`ret void`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);

    // Internal malloc function, renamed to yulang_malloc for external linkage
    generator.emit(`define internal i8* @yulang_malloc(i64 %size) {`, false);
    generator.indentLevel++;
    // Ensure heap is initialized before allocating
    generator.emit(`call void @__heap_init_internal()`);
    const allocRes = emitMemoryAllocate_ARM64(platform, generator, { value: '%size', type: 'i64' }); // Call emitMemoryAllocate from the memory module
    generator.emit(`ret i8* ${allocRes.value}`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);

    // memcpy inline implementation (byte loop)
    generator.emit(`define internal void @__memcpy_inline(i8* %dst, i8* %src, i64 %len) {`, false);
    generator.indentLevel++;
    const cmp = generator.getNewLabel('memcpy.cmp');
    const body = generator.getNewLabel('memcpy.body');
    const exit = generator.getNewLabel('memcpy.exit');
    const idx = generator.llvmHelper.getNewTempVar();
    generator.emit(`${idx} = alloca i64, align 8`);
    generator.emit(`store i64 0, i64* ${idx}, align 8`);
    generator.emit(`br label %${cmp}`);

    generator.emit(`${cmp}:`, false);
    const cur = generator.llvmHelper.getNewTempVar();
    generator.emit(`${cur} = load i64, i64* ${idx}, align 8`);
    const cond = generator.llvmHelper.getNewTempVar();
    generator.emit(`${cond} = icmp ult i64 ${cur}, %len`);
    generator.emit(`br i1 ${cond}, label %${body}, label %${exit}`);

    generator.emit(`${body}:`, false);
    const dstPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${dstPtr} = getelementptr inbounds i8, i8* %dst, i64 ${cur}`);
    const srcPtr = generator.llvmHelper.getNewTempVar();
    generator.emit(`${srcPtr} = getelementptr inbounds i8, i8* %src, i64 ${cur}`);
    const byteVal = generator.llvmHelper.getNewTempVar();
    generator.emit(`${byteVal} = load i8, i8* ${srcPtr}, align 1`);
    generator.emit(`store i8 ${byteVal}, i8* ${dstPtr}, align 1`);
    const next = generator.llvmHelper.getNewTempVar();
    generator.emit(`${next} = add i64 ${cur}, 1`);
    generator.emit(`store i64 ${next}, i64* ${idx}, align 8`);
    generator.emit(`br label %${cmp}`);

    generator.emit(`${exit}:`, false);
    generator.emit(`ret void`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);

    // Define syscall wrapper: __syscall6(n, a1..a6)
    generator.emit(`define internal i64 @__syscall6(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6) {`, false);
    generator.indentLevel++;
    const res = generator.llvmHelper.getNewTempVar();
    const asmCall = emitSyscallInlineASM_ARM64(generator, '%n', ['%a1', '%a2', '%a3', '%a4', '%a5', '%a6']); // Call local function
    generator.emit(`${res} = ${asmCall}`);
    generator.emit(`ret i64 ${res}`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);
}

// Emits global definitions for ARM64 Linux
export function emitGlobalDefinitions_ARM64(generator: IRGenerator): void {
    // Free list struct definition (for @__free_list)
    generator.emit(`%struct.free_node = type { i64, i8* }`, false);

    // Global heap-related variables
    generator.emit(`@__heap_base = internal global i8* null, align 8`, false);
    generator.emit(`@__heap_brk = internal global i8* null, align 8`, false);
    generator.emit(`@__heap_initialized = internal global i1 false, align 1`, false);
    generator.emit(`@__free_list = internal global %struct.free_node* null, align 8`, false);
}
