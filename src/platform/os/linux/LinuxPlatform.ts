import { IRGenerator, type IRValue } from "../../../generator/ir_generator.js";
import type { IArchitecture } from "../../IArchitecture.js";
import type { IPlatform } from "../../IPlatform.js";
import { LangItems } from "../../../generator/lang_items.js";

export class LinuxPlatform implements IPlatform {
    architecture: IArchitecture;

    constructor(arch: IArchitecture) {
        this.architecture = arch;
    }

    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
        // Prepare arguments for architecture-specific inline ASM
        const syscallArgs: string[] = args.map(a => {
            // Ensure all arguments are i64 for syscalls, converting pointers to i64
            if (a.type.endsWith('*')) {
                const tempVar = generator.llvmHelper.getNewTempVar();
                generator.emit(`${tempVar} = ptrtoint ${a.type} ${a.value} to i64`);
                return tempVar;
            }
            // For now, assume other integer types are coerced to i64 by generator.ensureI64
            // but for the inline asm, we need the actual i64 value.
            // This part needs careful handling, for simplicity now, assume they are i64 or can be directly used.
            // A more robust solution would be to call a helper that ensures i64 and returns the variable name.
            // For now, let's just pass the value directly and let the architecture handle i64 conversion if needed.
            return a.value;
        });
        
        // Pad with 0s if fewer than 6 arguments are provided
        while (syscallArgs.length < 6) syscallArgs.push("0");

        const resultVar = generator.llvmHelper.getNewTempVar();
        const callNumVal = generator.ensureI64(callNum); // Ensure syscall number is i64
        const asmCall = this.architecture.emitSyscallInlineASM(generator, callNumVal, syscallArgs);

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
        generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${this.architecture.getPointerAlignmentInBytes() - 1}`);
        const alignedSize2 = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-this.architecture.getPointerAlignmentInBytes()}`);

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
        generator.emit(`${alignedSize} = add i64 ${sizeI64}, ${this.architecture.getPointerAlignmentInBytes() - 1}`);
        const alignedSize2 = generator.llvmHelper.getNewTempVar();
        generator.emit(`${alignedSize2} = and i64 ${alignedSize}, ${-this.architecture.getPointerAlignmentInBytes()}`);


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
        // Internal heap init function
        generator.emit(`define void @__heap_init_internal() {`, false);
        generator.indentLevel++;
        const initFlagHeap = generator.llvmHelper.getNewTempVar();
        generator.emit(`${initFlagHeap} = load i1, i1* @__heap_initialized, align 1`);
        const doneLbl = generator.getNewLabel('heap.init.done');
        const doLbl = generator.getNewLabel('heap.init.do');
        generator.emit(`br i1 ${initFlagHeap}, label %${doneLbl}, label %${doLbl}`);
        generator.emit(`${doLbl}:`, false);
        generator.indentLevel++;
        // const currentBrkInit = generator.llvmHelper.getNewTempVar(); // 移除这行
        
        // Perform brk syscall (12) to get current program break
        const brkCallNum = { value: '12', type: 'i64' };
        const brkArgs = [{ value: '0', type: 'i64' }]; // Argument 0 for brk means get current break
        const brkSyscallResult = this.emitSyscall(generator, brkCallNum, brkArgs);
        const currentBrkValue = brkSyscallResult.value; // 直接使用结果变量
        
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
        generator.emit(`define i8* @yulang_malloc(i64 %size) {`, false);
        generator.indentLevel++;
        // Ensure heap is initialized before allocating
        generator.emit(`call void @__heap_init_internal()`);
        const allocRes = this.emitMemoryAllocate(generator, { value: '%size', type: 'i64' });
        generator.emit(`ret i8* ${allocRes.value}`);
        generator.indentLevel--;
        generator.emit(`}`, false);
        generator.emit(``, false);

        // memcpy inline implementation (byte loop) - moved from IRGenerator
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
        const asmCall = this.architecture.emitSyscallInlineASM(generator, '%n', ['%a1', '%a2', '%a3', '%a4', '%a5', '%a6']);
        generator.emit(`${res} = ${asmCall}`);
        generator.emit(`ret i64 ${res}`);
        generator.indentLevel--;
        generator.emit(`}`, false);
        generator.emit(``, false);
    }

    emitGlobalDefinitions(generator: IRGenerator): void {
        // Free list struct definition (needed for @__free_list)
        generator.emit(`%struct.free_node = type { i64, i8* }`, false);

        // Global heap-related variables
        generator.emit(`@__heap_base = internal global i8* null, align 8`, false);
        generator.emit(`@__heap_brk = internal global i8* null, align 8`, false);
        generator.emit(`@__heap_initialized = internal global i1 false, align 1`, false);
        generator.emit(`@__free_list = internal global %struct.free_node* null, align 8`, false);
    }
}
