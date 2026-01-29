// 1. 代码段开始
.section .text
.global _start

_start:
    // --- 关键：栈对齐 ---
    // ARM64 中，sp (Stack Pointer) 必须 16 字节对齐
    // 下面这条指令会将 sp 的低 4 位清零
    mov x0, sp
    and x0, x0, #0xfffffffffffffff0
    mov sp, x0

    // --- 逻辑跳转 ---
    // 调用 C 语言的 main 函数
    bl main

    // --- 退出处理 ---
    // main 的返回值在 x0 中，这正好是 exit 的第一个参数 (error_code)
    // mov x0, x0  // 这一步逻辑上存在，但由于已经在 x0 中，可以省略
    
    mov x8, #93         // ARM64 的 exit 系统调用号是 93 (x86_64 是 60)
    svc #0              // 执行系统调用 (Supervisor Call)

// ---------------------------------------------------------
// 2. 安全声明
// ---------------------------------------------------------
.section .note.GNU-stack,"",@progbits
