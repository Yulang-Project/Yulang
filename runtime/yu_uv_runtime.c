#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

typedef struct {
    char *ptr;
    int64_t length;
} yu_string;

typedef void (*yu_read_file_cb)(void *env, int32_t err, yu_string data);

typedef struct {
    uv_work_t req;
    yu_read_file_cb cb;
    void *env;
    char *path;
    char *data;
    int64_t length;
    int32_t err;
} yu_read_file_work;

extern void *GC_malloc(size_t size);

static char yu_empty_string[] = "";

void yu_uv_init(void) {
    uv_default_loop();
}

int32_t yu_uv_run(void) {
    return uv_run(uv_default_loop(), UV_RUN_DEFAULT);
}

static void yu_read_file_worker(uv_work_t *req) {
    yu_read_file_work *work = (yu_read_file_work *)req->data;
    FILE *file = fopen(work->path, "rb");
    if (!file) {
        work->err = errno ? -errno : -1;
        return;
    }

    if (fseek(file, 0, SEEK_END) != 0) {
        work->err = errno ? -errno : -1;
        fclose(file);
        return;
    }

    long size = ftell(file);
    if (size < 0) {
        work->err = errno ? -errno : -1;
        fclose(file);
        return;
    }

    if (fseek(file, 0, SEEK_SET) != 0) {
        work->err = errno ? -errno : -1;
        fclose(file);
        return;
    }

    char *buffer = (char *)malloc((size_t)size + 1);
    if (!buffer) {
        work->err = -ENOMEM;
        fclose(file);
        return;
    }

    size_t read_count = fread(buffer, 1, (size_t)size, file);
    if (read_count != (size_t)size && ferror(file)) {
        work->err = errno ? -errno : -1;
        free(buffer);
        fclose(file);
        return;
    }

    buffer[read_count] = '\0';
    work->data = buffer;
    work->length = (int64_t)read_count;
    work->err = 0;
    fclose(file);
}

static void yu_read_file_after(uv_work_t *req, int status) {
    yu_read_file_work *work = (yu_read_file_work *)req->data;
    yu_string data;
    int32_t err = status < 0 ? status : work->err;

    if (err == 0 && work->data) {
        char *gc_data = (char *)GC_malloc((size_t)work->length + 1);
        memcpy(gc_data, work->data, (size_t)work->length + 1);
        data.ptr = gc_data;
        data.length = work->length;
    } else {
        data.ptr = yu_empty_string;
        data.length = 0;
    }

    if (work->cb) {
        work->cb(work->env, err, data);
    }

    free(work->data);
    free(work->path);
    free(work);
}

int32_t yu_fs_readFile(yu_string path, void *code, void *env) {
    if (!path.ptr || !code) {
        return -EINVAL;
    }

    yu_read_file_work *work = (yu_read_file_work *)calloc(1, sizeof(yu_read_file_work));
    if (!work) {
        return -ENOMEM;
    }

    work->path = (char *)malloc((size_t)path.length + 1);
    if (!work->path) {
        free(work);
        return -ENOMEM;
    }

    memcpy(work->path, path.ptr, (size_t)path.length);
    work->path[path.length] = '\0';
    work->cb = (yu_read_file_cb)code;
    work->env = env;
    work->req.data = work;

    int rc = uv_queue_work(uv_default_loop(), &work->req, yu_read_file_worker, yu_read_file_after);
    if (rc != 0) {
        free(work->path);
        free(work);
        return rc;
    }

    return 0;
}
