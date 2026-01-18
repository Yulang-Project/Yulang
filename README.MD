# Yulang

**A high-performance, object-oriented compiled language designed for the modern web and system backends.**

[![Status](https://img.shields.io/badge/Status-Under%20Development-orange)](#)
[![Team](https://img.shields.io/badge/Team-WindyPear-blue)](https://windypear.com)

Yulang is a next-generation compiled language that bridges the gap between the flexibility of dynamic object-oriented programming and the raw performance of low-level machine code. Built on top of **LLVM**, Yulang aims to provide a "weakly-typed feel" with the safety and speed of a strictly optimized binary.

---

## 💡 The Philosophy

Yulang is built on the belief that developers shouldn't have to choose between the **expressiveness of objects** and the **speed of C**. 

- **Object-Oriented Compilation**: Almost everything is an object at the syntax level, but a zero-cost structure at the machine level.
- **Performance-First Design**: Leveraging aggressive escape analysis and static lifecycle management to eliminate GC overhead.
- **Backend Specialization**: Designed specifically for high-concurrency web servers, featuring native support for system-level primitives like `epoll` and direct `syscall` access.
- **Zero-Cost Abstraction**: Use high-level abstractions without worrying about hidden memory or CPU costs.

---

## 🚀 Key Features

* **Smart Lifecycle Management**: An advanced compiler-driven memory system that automatically decides where to insert cleanup logic, prompting the user only when manual intervention is required for peak performance.
* **System Integrity**: Direct access to memory addresses for `syscall` operations while maintaining a safe object-oriented wrapper.
* **LLVM Powered**: Generates highly optimized machine code with state-of-the-art backend optimizations (O3).
* **The "Weak-Type" Experience**: Designed to feel as intuitive as TypeScript or Python, but running with the velocity of Rust or C++.

---

## 🛠 Project Status: Under Development

Yulang is currently in its **active development phase**. Our team is working hard on the core compiler architecture, memory optimization passes, and the standard library.

---

## 🌐 Links

- **Official Website:** [https://lang.yumeri.dev](https://lang.yumeri.dev)
- **Developed by:** [WindyPear-Team (风梨团队)](https://windypear.com)

---

## 🤝 Contributing

We are passionate about building a language that empowers backend developers. If you are interested in compiler theory, LLVM, or high-performance systems, stay tuned for our public beta and contribution guidelines.

---

**Yulang** — *The power of the machine, the soul of the object.*
