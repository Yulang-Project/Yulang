#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

typedef struct {
    char *ptr;
    int64_t length;
} yu_string;

typedef struct {
    yu_string value;
    int resolved;
} yu_string_promise;

typedef void (*yu_read_file_cb)(void *env, int32_t err, yu_string data);

typedef struct {
    yu_string_promise *promise;
} yu_read_sync_ctx;

typedef struct yu_read_file_req {
    uv_fs_t open_req;
    uv_fs_t stat_req;
    uv_fs_t read_req;
    uv_fs_t close_req;
    uv_buf_t buf;
    uv_file file;
    yu_read_file_cb cb;
    void *env;
    char *path;
    char *data;
    int64_t length;
    int32_t err;
} yu_read_file_req;

extern void *GC_malloc(size_t size);

static char yu_empty_string[] = "";

void yu_uv_init(void) {
    uv_default_loop();
}

int32_t yu_uv_run(void) {
    return uv_run(uv_default_loop(), UV_RUN_DEFAULT);
}

static yu_string yu_gc_string_from_owned(char *data, int64_t length, int32_t err) {
    yu_string result;
    if (err == 0 && data) {
        char *gc_data = (char *)GC_malloc((size_t)length + 1);
        memcpy(gc_data, data, (size_t)length + 1);
        result.ptr = gc_data;
        result.length = length;
    } else {
        result.ptr = yu_empty_string;
        result.length = 0;
    }
    return result;
}

static void yu_fs_finish(yu_read_file_req *req) {
    yu_string data = yu_gc_string_from_owned(req->data, req->length, req->err);
    if (req->cb) {
        req->cb(req->env, req->err, data);
    }
    free(req->data);
    free(req->path);
    free(req);
}

static void yu_on_close(uv_fs_t *close_req) {
    yu_read_file_req *req = (yu_read_file_req *)close_req->data;
    uv_fs_req_cleanup(close_req);
    yu_fs_finish(req);
}

static void yu_close_after_error(yu_read_file_req *req) {
    req->close_req.data = req;
    uv_fs_close(uv_default_loop(), &req->close_req, req->file, yu_on_close);
}

static void yu_on_read(uv_fs_t *read_req) {
    yu_read_file_req *req = (yu_read_file_req *)read_req->data;
    if (read_req->result < 0) {
        req->err = (int32_t)read_req->result;
        req->length = 0;
    } else {
        req->length = (int64_t)read_req->result;
        req->data[req->length] = '\0';
        req->err = 0;
    }
    uv_fs_req_cleanup(read_req);
    yu_close_after_error(req);
}

static void yu_on_fstat(uv_fs_t *stat_req) {
    yu_read_file_req *req = (yu_read_file_req *)stat_req->data;
    if (stat_req->result < 0) {
        req->err = (int32_t)stat_req->result;
        uv_fs_req_cleanup(stat_req);
        yu_close_after_error(req);
        return;
    }

    int64_t size = (int64_t)stat_req->statbuf.st_size;
    if (size < 0) size = 0;
    req->data = (char *)malloc((size_t)size + 1);
    if (!req->data) {
        req->err = -ENOMEM;
        uv_fs_req_cleanup(stat_req);
        yu_close_after_error(req);
        return;
    }

    req->buf = uv_buf_init(req->data, (unsigned int)size);
    req->read_req.data = req;
    uv_fs_req_cleanup(stat_req);
    int rc = uv_fs_read(uv_default_loop(), &req->read_req, req->file, &req->buf, 1, 0, yu_on_read);
    if (rc < 0) {
        req->err = rc;
        yu_close_after_error(req);
    }
}

static void yu_on_open(uv_fs_t *open_req) {
    yu_read_file_req *req = (yu_read_file_req *)open_req->data;
    if (open_req->result < 0) {
        req->err = (int32_t)open_req->result;
        uv_fs_req_cleanup(open_req);
        yu_fs_finish(req);
        return;
    }

    req->file = (uv_file)open_req->result;
    uv_fs_req_cleanup(open_req);
    req->stat_req.data = req;
    int rc = uv_fs_fstat(uv_default_loop(), &req->stat_req, req->file, yu_on_fstat);
    if (rc < 0) {
        req->err = rc;
        yu_close_after_error(req);
    }
}

int32_t yu_fs_readFile(yu_string path, void *code, void *env) {
    if (!path.ptr || !code) {
        return -EINVAL;
    }

    yu_read_file_req *req = (yu_read_file_req *)calloc(1, sizeof(yu_read_file_req));
    if (!req) return -ENOMEM;

    req->path = (char *)malloc((size_t)path.length + 1);
    if (!req->path) {
        free(req);
        return -ENOMEM;
    }
    memcpy(req->path, path.ptr, (size_t)path.length);
    req->path[path.length] = '\0';
    req->cb = (yu_read_file_cb)code;
    req->env = env;
    req->open_req.data = req;

    int rc = uv_fs_open(uv_default_loop(), &req->open_req, req->path, O_RDONLY, 0, yu_on_open);
    if (rc < 0) {
        free(req->path);
        free(req);
        return rc;
    }
    return 0;
}

static int32_t yu_write_file_sync(yu_string path, yu_string data, const char *mode) {
    char *path_buf = (char *)malloc((size_t)path.length + 1);
    if (!path_buf) return -ENOMEM;
    memcpy(path_buf, path.ptr, (size_t)path.length);
    path_buf[path.length] = '\0';

    uv_fs_t open_req;
    int flags = O_WRONLY | O_CREAT;
    if (mode[0] == 'a') flags |= O_APPEND;
    else flags |= O_TRUNC;

    int rc = uv_fs_open(uv_default_loop(), &open_req, path_buf, flags, 0666, NULL);
    uv_fs_req_cleanup(&open_req);
    free(path_buf);
    if (rc < 0) return rc;

    uv_file file = (uv_file)rc;
    uv_buf_t buf = uv_buf_init(data.ptr, (unsigned int)data.length);
    uv_fs_t write_req;
    rc = uv_fs_write(uv_default_loop(), &write_req, file, &buf, 1, -1, NULL);
    uv_fs_req_cleanup(&write_req);

    uv_fs_t close_req;
    int close_rc = uv_fs_close(uv_default_loop(), &close_req, file, NULL);
    uv_fs_req_cleanup(&close_req);

    if (rc < 0) return rc;
    if (close_rc < 0) return close_rc;
    return rc;
}

static void yu_read_sync_cb(void *env, int32_t err, yu_string data) {
    yu_read_sync_ctx *ctx = (yu_read_sync_ctx *)env;
    ctx->promise->value = err == 0 ? data : (yu_string){ yu_empty_string, 0 };
    ctx->promise->resolved = 1;
}

yu_string yu_uv_readFileSync(yu_string path) {
    yu_string_promise promise;
    promise.value.ptr = yu_empty_string;
    promise.value.length = 0;
    promise.resolved = 0;

    yu_read_sync_ctx ctx;
    ctx.promise = &promise;
    int rc = yu_fs_readFile(path, (void *)yu_read_sync_cb, &ctx);
    if (rc < 0) {
        promise.resolved = 1;
    } else {
        while (!promise.resolved) {
            uv_run(uv_default_loop(), UV_RUN_DEFAULT);
        }
    }
    return promise.value;
}

int32_t yu_uv_writeFileSync(yu_string path, yu_string data) {
    return yu_write_file_sync(path, data, "w");
}

int32_t yu_uv_appendFileSync(yu_string path, yu_string data) {
    return yu_write_file_sync(path, data, "a");
}

static char *yu_c_path_from_string(yu_string path) {
    char *path_buf = (char *)malloc((size_t)path.length + 1);
    if (!path_buf) return NULL;
    memcpy(path_buf, path.ptr, (size_t)path.length);
    path_buf[path.length] = '\0';
    return path_buf;
}

int32_t yu_uv_accessSync(yu_string path, int32_t mode) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_access(uv_default_loop(), &req, path_buf, mode, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_unlinkSync(yu_string path) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_unlink(uv_default_loop(), &req, path_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_renameSync(yu_string old_path, yu_string new_path) {
    char *old_buf = yu_c_path_from_string(old_path);
    char *new_buf = yu_c_path_from_string(new_path);
    if (!old_buf || !new_buf) {
        free(old_buf);
        free(new_buf);
        return -ENOMEM;
    }
    uv_fs_t req;
    int rc = uv_fs_rename(uv_default_loop(), &req, old_buf, new_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(old_buf);
    free(new_buf);
    return rc;
}

int32_t yu_uv_mkdirSync(yu_string path, int32_t mode) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_mkdir(uv_default_loop(), &req, path_buf, mode, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}

int32_t yu_uv_rmdirSync(yu_string path) {
    char *path_buf = yu_c_path_from_string(path);
    if (!path_buf) return -ENOMEM;
    uv_fs_t req;
    int rc = uv_fs_rmdir(uv_default_loop(), &req, path_buf, NULL);
    uv_fs_req_cleanup(&req);
    free(path_buf);
    return rc;
}
