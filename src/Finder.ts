// src/Finder.ts
import * as path from 'path';

// 定义标准库查找器的接口
export interface IFinder {
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string;
    getBootstrapPath(osIdentifier: string, archIdentifier: string): string;
    getLinkerDynamicLinker(osIdentifier: string, archIdentifier: string): string;
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[];
}

// ProjectFinder 实现了 IFinder 接口，负责根据项目结构查找标准库路径
export class ProjectFinder implements IFinder {
    private projectRoot: string; // 项目根目录
    private stdLibRootPath: string; // 标准库在项目根目录下的相对路径，例如 "libs"

    constructor(projectRoot: string, stdLibRootPath: string = 'libs') {
        this.projectRoot = projectRoot;
        this.stdLibRootPath = stdLibRootPath;
    }

    // 获取标准库模块的完整路径 (e.g., "std/io" -> "/path/to/project_root/libs/linux/x86_64/std/io.yu")
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string {
        // 构建标准库模块的基路径，例如 "libs/linux/x86_64/std"
        const stdLibBaseDir = path.join(this.stdLibRootPath, osIdentifier, archIdentifier, 'std');

        if (moduleName === 'std' || moduleName === 'std/') {
            return path.join(this.projectRoot, stdLibBaseDir, 'std.yu');
        }

        const relativeModuleName = moduleName.startsWith('std/') ? moduleName.slice(4) : moduleName;
        
        // 构建模块的完整路径，例如 "/path/to/project_root/libs/linux/x86_64/std/io.yu"
        const fullPath = path.join(this.projectRoot, stdLibBaseDir, `${relativeModuleName}.yu`);
        return fullPath;
    }

    // 获取引导文件 (bootstrap.o) 的完整路径 (e.g., "/path/to/project_root/libs/linux/x86_64/bootstrap.o")
    getBootstrapPath(osIdentifier: string, archIdentifier: string): string {
        // 构建特定架构的 bootstrap 文件名 (例如 "bootstrap_x86_64.o")
        const bootstrapFileName = `bootstrap_${archIdentifier}.o`;
        // 构建完整路径
        const fullPath = path.join(this.projectRoot, this.stdLibRootPath, osIdentifier, archIdentifier, bootstrapFileName);
        return fullPath;
    }

    // 获取动态链接器路径
    getLinkerDynamicLinker(osIdentifier: string, archIdentifier: string): string {
        // 根据 OS 和 Arch 提供硬编码的动态链接器路径
        if (osIdentifier === 'linux' && archIdentifier === 'x86_64') {
            return '/lib64/ld-linux-x86-64.so.2';
        }
        // TODO: Add other OS/Arch combinations
        throw new Error(`Unsupported dynamic linker for ${osIdentifier}-${archIdentifier}`);
    }

    // 获取额外的链接器标志
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[] {
        // 根据 OS 和 Arch 提供硬编码的链接器标志
        if (osIdentifier === 'linux' && archIdentifier === 'x86_64') {
            return ['-m', 'elf_x86_64', '--eh-frame-hdr', '-pie', '-z', 'relro', '-z', 'now'];
        }
        // TODO: Add other OS/Arch combinations
        return [];
    }
}
