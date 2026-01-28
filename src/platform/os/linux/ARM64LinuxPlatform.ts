import { IRGenerator, type IRValue } from "../../../generator/ir_generator.js";
import type { IPlatform } from "../../IPlatform.js";

// ARM64LinuxPlatform 实现了 IPlatform 接口，并封装了 ARM64 架构在 Linux 操作系统上的特性。
export class ARM64LinuxPlatform implements IPlatform {
    constructor() {
    }

    getTargetTriple(): string {
        return "aarch64-unknown-linux-gnu"; // 标准 Linux ARM64 三元组
    }

    getDataLayout(): string {
        return "e-m:e-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128"; // 常见 ARM64 Linux 数据布局
    }

    emitSyscallInlineASM(generator: IRGenerator, callNum: string, args: string[]): string {
        // ARM64 Linux 系统调用参数寄存器: X0 - X7
        // 系统调用号放入 X8
        // 返回值在 X0

        // 输出约束: "={x0}" 用于返回值
        // 输入约束: "{x8}" 用于系统调用号 (X8), "{x0}", "{x1}", 等用于参数
        // Clobbers: "x2", "x3", "x4", "x5", "x6", "x7", "lr" (link register x30) for general syscall safety

        const argRegisters = ["{x0}", "{x1}", "{x2}", "{x3}", "{x4}", "{x5}", "{x6}", "{x7}"];
        let asmInputs = [callNum, ...args];
        let inputConstraints = ["{x8}"]; // Syscall number in X8 (0th input)

        for (let i = 0; i < args.length && i < argRegisters.length; i++) {
            inputConstraints.push(argRegisters[i] as string);
        }

        // 如果提供的参数少于 8 个，用 0 填充
        while (asmInputs.length < 9) { // 1 个系统调用号 + 8 个参数 (X0-X7)
            asmInputs.push("i64 0"); // 用哑 i64 0 填充
            inputConstraints.push(""); // 哑参数没有特定的寄存器约束
        }
        
        const outputConstraint = "={x0}"; // 返回值放入 X0
        const clobbers = "~{x2},~{x3},~{x4},~{x5},~{x6},~{x7},~{x30},~{memory}"; // 标准系统调用 clobbers
        
        const constraints = `"${outputConstraint},${inputConstraints.slice(0, 9).join(',')},${clobbers}"`;
        const operands = asmInputs.slice(0, 9).map(arg => `i64 ${arg}`).join(', ');

        // 实际的 ASM 指令就是 "svc #0"
        return `call i64 asm sideeffect "svc #0", ${constraints}(${operands})`;
    }

    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
        // 为架构特定的内联汇编准备参数
        const syscallArgs: string[] = args.map(a => {
            // 确保所有参数都是 i64 用于系统调用，将指针转换为 i64
            if (a.type.endsWith('*')) {
                const tempVar = generator.llvmHelper.getNewTempVar();
                generator.emit(`${tempVar} = ptrtoint ${a.type} ${a.value} to i64`);
                return tempVar;
            }
            // 假设其他整数类型会被 generator.ensureI64 强制转换为 i64
            // 但对于内联汇编，我们需要实际的 i64 值。
            // 暂时直接传递值，让架构在需要时处理 i64 转换。
            return a.value;
        });
        
        // 如果提供的参数少于 8 个，用 0 填充
        while (syscallArgs.length < 8) syscallArgs.push("0");

        const resultVar = generator.llvmHelper.getNewTempVar();
        const callNumVal = generator.ensureI64(callNum); // 确保系统调用号是 i64
        const asmCall = this.emitSyscallInlineASM(generator, callNumVal, syscallArgs);

        generator.emit(`${resultVar} = ${asmCall}`);
        return { value: resultVar, type: 'i64' };
    }

    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue {
        // 实现使用 brk 系统调用 (Linux 的 syscall 12)
        // 这是一个简化的 bump allocator。真实的 mmap 会更复杂。
        
        // 确保 size 是 i64
        const sizeI64 = generator.ensureI64(size);

        // 获取对齐后的 size
        const alignedSize = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${this.getPointerAlignmentInBytes() - 1}`);
        const alignedSize2 = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-this.getPointerAlignmentInBytes()}`);

        const currentBrk = generator.llvmHelper.getNewTempVar();
        generator.emit(`${currentBrk} = load i8*, i8** @__heap_brk, align 8`);

        const nextBrk = generator.llvmHelper.getNewTempVar();
        generator.emit(`${nextBrk} = getelementptr inbounds i8, i8* ${currentBrk}, i64 ${alignedSize2}`);

        const nextBrkInt = generator.llvmHelper.getNewTempVar();
        generator.emit(`${nextBrkInt} = ptrtoint i8* ${nextBrk} to i64`);
        
        // 执行 brk 系统调用 (12)
        const brkCallNum = { value: '12', type: 'i64' };
        const brkArgs = [{ value: nextBrkInt, type: 'i64' }];
        const brkSyscallResult = this.emitSyscall(generator, brkCallNum, brkArgs);
        
        const brkPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${brkPtr} = inttoptr i64 ${brkSyscallResult.value} to i8*`);
        generator.emit(`store i8* ${brkPtr}, i8** @__heap_brk, align 8`);

        return { value: currentBrk, type: 'i8*' };
    }

    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void {
        // 这是一个非常简化的 free，用于 bump allocator (只回收堆顶部)
        // 确保 addr 是 i8* 且 size 是 i64
        let addrI8Ptr = addr.value;
        if (addr.type !== 'i8*') {
            const tempVar = generator.llvmHelper.getNewTempVar();
            generator.emit(`${tempVar} = bitcast ${addr.type} ${addr.value} to i8*`);
            addrI8Ptr = tempVar;
        }
        const sizeI64 = generator.ensureI64(size);

        // 获取对齐后的 size
        const alignedSize = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${this.getPointerAlignmentInBytes() - 1}`);
        const alignedSize2 = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-this.getPointerAlignmentInBytes()}`);


        const currentBrk = generator.llvmHelper.getNewTempVar();
        generator.emit(`${currentBrk} = load i8*, i8** @__heap_brk, align 8`);

        const nextPtr = generator.llvmHelper.getNewTempVar();
        generator.emit(`${nextPtr} = getelementptr inbounds i8, i8* ${addrI8Ptr}, i64 ${alignedSize2}`);

        const isTop = generator.llvmHelper.getNewTempVar();
        generator.emit(`${isTop} = icmp eq i8* ${nextPtr}, ${currentBrk}`);

        const retEnd = generator.getNewLabel('free.end');
        const retTop = generator.getNewLabel('free.top');
        generator.emit(`br i1 ${isTop}, label %${retTop}, label %${retEnd}`);

        generator.emit(`${retTop}:`, false);
        generator.indentLevel++;
        const ptrInt = generator.llvmHelper.getNewTempVar();
        generator.emit(`${ptrInt} = ptrtoint i8* ${addrI8Ptr} to i64`);
        
        // 执行 brk 系统调用 (12)
        const brkCallNum = { value: '12', type: 'i64' };
        const brkArgs = [{ value: ptrInt, type: 'i64' }];
        this.emitSyscall(generator, brkCallNum, brkArgs); // 结果在此处未使用
        
        generator.emit(`store i8* ${addrI8Ptr}, i8** @__heap_brk, align 8`);
        generator.emit(`br label %${retEnd}`);
        generator.indentLevel--;

        generator.emit(`${retEnd}:`, false);
        // 实际的 `ret void` 将由调用者处理。这只是为了内部 free 函数。
    }

    emitLowLevelRuntime(generator: IRGenerator): void {
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
        const brkSyscallResult = this.emitSyscall(generator, brkCallNum, brkArgs);
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
        const allocRes = this.emitMemoryAllocate(generator, { value: '%size', type: 'i64' });
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
        const asmCall = this.emitSyscallInlineASM(generator, '%n', ['%a1', '%a2', '%a3', '%a4', '%a5', '%a6']);
        generator.emit(`${res} = ${asmCall}`);
        generator.emit(`ret i64 ${res}`);
        generator.indentLevel--;
        generator.emit(`}`, false);
        generator.emit(``, false);
    }

    emitGlobalDefinitions(generator: IRGenerator): void {
        // 空闲列表结构定义 (用于 @__free_list)
        generator.emit(`%struct.free_node = type { i64, i8* }`, false);

        // 全局堆相关变量
        generator.emit(`@__heap_base = internal global i8* null, align 8`, false);
        generator.emit(`@__heap_brk = internal global i8* null, align 8`, false);
        generator.emit(`@__heap_initialized = internal global i1 false, align 1`, false);
        generator.emit(`@__free_list = internal global %struct.free_node* null, align 8`, false);
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
}