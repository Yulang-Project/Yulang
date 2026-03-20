	.text
	.file	"simple.yu"
	.globl	print                           # -- Begin function print
	.p2align	4, 0x90
	.type	print,@function
print:                                  # @print
	.cfi_startproc
# %bb.0:                                # %entry
	movq	%rsi, %rdx
	movq	%rdi, %rsi
	movq	%rdx, -8(%rsp)
	movq	%rdi, -16(%rsp)
	movq	%rdi, -24(%rsp)
	movq	%rdx, -32(%rsp)
	movl	$1, %edi
	movl	$1, %eax
	#APP
	syscall
	#NO_APP
	retq
.Lfunc_end0:
	.size	print, .Lfunc_end0-print
	.cfi_endproc
                                        # -- End function
	.globl	main                            # -- Begin function main
	.p2align	4, 0x90
	.type	main,@function
main:                                   # @main
	.cfi_startproc
# %bb.0:                                # %entry
	pushq	%rax
	.cfi_def_cfa_offset 16
	movq	.string.0@GOTPCREL(%rip), %rdi
	callq	print@PLT
	xorl	%eax, %eax
	popq	%rcx
	.cfi_def_cfa_offset 8
	retq
.Lfunc_end1:
	.size	main, .Lfunc_end1-main
	.cfi_endproc
                                        # -- End function
	.type	.str.0,@object                  # @.str.0
	.section	.rodata,"a",@progbits
	.globl	.str.0
.str.0:
	.asciz	"hello\n"
	.size	.str.0, 7

	.type	.string.0,@object               # @.string.0
	.section	.data.rel.ro,"aw",@progbits
	.globl	.string.0
	.p2align	3, 0x0
.string.0:
	.quad	.str.0
	.quad	6                               # 0x6
	.size	.string.0, 16

	.section	".note.GNU-stack","",@progbits
