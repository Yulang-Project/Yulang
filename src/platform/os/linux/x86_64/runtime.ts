import { IRGenerator } from "../../../../generator/ir_generator.js";
import { X86_64LinuxPlatform } from "./platform.js";
import { emitSyscall_X86_64, emitSyscallInlineASM_X86_64 } from "./syscalls.js"; // For brk in emitLowLevelRuntime
import { emitMemoryAllocate_X86_64 } from "./memory.js"; // For malloc

// 发出 x86-64 Linux 平台上的低级运行时函数
export function emitLowLevelRuntime_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator): void {
    // 内部堆初始化函数
    generator.emit(`define internal void @__heap_init_internal() {`, false);
    generator.indentLevel++;
    const initFlagHeap = generator.llvmHelper.getNewTempVar();
    generator.emit(`${initFlagHeap} = load i1, i1* @__heap_initialized, align 1`);
    const doneLbl = generator.getNewLabel('heap.init.done');
    const doLbl = generator.getNewLabel('heap.init.do');
    generator.emit(`br i1 ${initFlagHeap}, label %${doneLbl}, label %${doLbl}`);
    generator.emit(`${doLbl}:`, false);
    generator.indentLevel++;
    
    // 执行 brk 系统调用 (12) 以获取当前程序中断点
    const brkCallNum = { value: '12', type: 'i64' };
    const brkArgs = [{ value: '0', type: 'i64' }]; // 参数 0 表示获取当前中断点
    const brkSyscallResult = emitSyscall_X86_64(platform, generator, brkCallNum, brkArgs);
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

    // 内部 malloc 函数，重命名为 yulang_malloc 以便外部链接
    generator.emit(`define internal i8* @yulang_malloc(i64 %size) {`, false);
    generator.indentLevel++;
    // 在分配内存之前确保堆已初始化
    generator.emit(`call void @__heap_init_internal()`);
    const allocRes = emitMemoryAllocate_X86_64(platform, generator, { value: '%size', type: 'i64' }); // 调用平台中的 emitMemoryAllocate
    generator.emit(`ret i8* ${allocRes.value}`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);

    // memcpy 内联实现 (字节循环)
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

    // 定义 syscall 包装器: __syscall6(n, a1..a6)
    generator.emit(`define internal i64 @__syscall6(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6) {`, false);
    generator.indentLevel++;
    const res = generator.llvmHelper.getNewTempVar();
    const asmCall = emitSyscallInlineASM_X86_64(generator, '%n', ['%a1', '%a2', '%a3', '%a4', '%a5', '%a6']); // 直接调用本地函数
    generator.emit(`${res} = ${asmCall}`);
    generator.emit(`ret i64 ${res}`);
    generator.indentLevel--;
    generator.emit(`}`, false);
    generator.emit(``, false);
}

// 发出 x86-64 Linux 平台上的全局定义
export function emitGlobalDefinitions_X86_64(generator: IRGenerator): void {
    // 空闲列表结构定义 (用于 @__free_list)
    generator.emit(`%struct.free_node = type { i64, i8* }`, false);

    // 全局堆相关变量
    generator.emit(`@__heap_base = internal global i8* null, align 8`, false);
    generator.emit(`@__heap_brk = internal global i8* null, align 8`, false);
    generator.emit(`@__heap_initialized = internal global i1 false, align 1`, false);
    generator.emit(`@__free_list = internal global %struct.free_node* null, align 8`, false);
}
