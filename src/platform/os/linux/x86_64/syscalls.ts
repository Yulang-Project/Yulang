import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
import * as irgen_utils from "../../../../generator/irgen/ir_generator_utils.js";
import { X86_64LinuxPlatform } from "./platform.js"; // 导入主平台类，以便调用其方法

// 汇编 x86-64 Linux 系统调用的内联汇编
export function emitSyscallInlineASM_X86_64(generator: IRGenerator, callNum: string, args: string[]): string {
    const argRegisters = ["{rdi}", "{rsi}", "{rdx}", "{r10}", "{r8}", "{r9}"];
    let asmInputs = [callNum, ...args];
    let inputConstraints = ["0"];

    for (let i = 0; i < args.length && i < argRegisters.length; i++) {
        inputConstraints.push(argRegisters[i] as string);
    }

    while (asmInputs.length < 7) {
        asmInputs.push("i64 0");
        inputConstraints.push("");
    }
    
    const outputConstraint = "={rax}";
    const clobbers = "~{rcx},~{r11},~{memory}";
    
    const constraints = `"${outputConstraint},${inputConstraints.slice(0, 7).join(',')},${clobbers}"`;
    const operands = asmInputs.slice(0, 7).map(arg => `i64 ${arg}`).join(', ');

    return `call i64 asm sideeffect "syscall", ${constraints}(${operands})`;
}

// 发出 x86-64 Linux 上的系统调用
export function emitSyscall_X86_64(platform: X86_64LinuxPlatform, generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue {
    const syscallArgs: string[] = args.map(a => {
        if (a.type.endsWith('*')) {
            const tempVar = generator.llvmHelper.getNewTempVar();
            generator.emit(`${tempVar} = ptrtoint ${a.type} ${a.value} to i64`);
            return tempVar;
        }
        return a.value;
    });
    
    while (syscallArgs.length < 6) syscallArgs.push("0");

    const resultVar = generator.llvmHelper.getNewTempVar();
    const callNumVal = irgen_utils.ensureI64(generator, callNum);
    const asmCall = emitSyscallInlineASM_X86_64(generator, callNumVal, syscallArgs); // 直接调用本地函数

    generator.emit(`${resultVar} = ${asmCall}`);
    return { value: resultVar, type: 'i64' };
}