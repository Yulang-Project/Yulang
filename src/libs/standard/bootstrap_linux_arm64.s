.section .text
.global _start

_start:
    // --- 关键：栈对齐 ---
    // 内核把 argc 和 argv 压栈后，SP 往往是 8 字节对齐。
    // 我们必须强制 16 字节对齐，否则 LLVM 内部的某些指令会报 Segment Fault。
    bic sp, sp, #15 // 清除 SP 的低 4 位，确保 16 字节对齐

    // --- 获取 argc 和 argv ---
    // argc 已经在 x0 中
    // argv 已经在 x1 中
    // 无需额外移动寄存器，直接传递给 main

    // --- 逻辑跳转 ---
    bl main         // 调用 main 函数，bl 是带链接的跳转指令，会自动保存返回地址到 LR (X30)

    // --- 退出处理 ---
    // main 函数的返回值在 X0 中 (通过 bl main 后的返回)，这正好是 exit 的第一个参数 (error_code)
    mov x8, #93     // sys_exit 的编号 (Linux ARM64 的 exit 系统调用号是 93)
    svc #0          // 执行系统调用

.section .note.GNU-stack,"",@progbits