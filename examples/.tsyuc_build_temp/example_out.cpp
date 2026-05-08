#include "yu_runtime.h"
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

int32_t main();

int32_t main() {
    yu_string msg = (yu_string){(char*)"Hello from YuLang with Closures and Arrays!", 43};
    printf((yu_string){(char*)"%s
", 3}, msg.ptr);
    yu_array arr = ({ yu_array arr_0; arr_0.length = 2; arr_0.capacity = 2; arr_0.ptr = GC_malloc(sizeof(void*) * 2); ((void**)arr_0.ptr)[0] = (void*)10; ((void**)arr_0.ptr)[1] = (void*)20; arr_0; });
    printf((yu_string){(char*)"Initial length: %d
", 19}, arr.length);
    ({ yu_array* arr_push_1 = &arr; if (arr_push_1->length >= arr_push_1->capacity) { arr_push_1->capacity = arr_push_1->capacity == 0 ? 4 : arr_push_1->capacity * 2; arr_push_1->ptr = GC_realloc(arr_push_1->ptr, arr_push_1->capacity * sizeof(void*)); } ((void**)arr_push_1->ptr)[arr_push_1->length++] = (void*)(intptr_t)30; arr_push_1->length; });
    ({ yu_array* arr_push_2 = &arr; if (arr_push_2->length >= arr_push_2->capacity) { arr_push_2->capacity = arr_push_2->capacity == 0 ? 4 : arr_push_2->capacity * 2; arr_push_2->ptr = GC_realloc(arr_push_2->ptr, arr_push_2->capacity * sizeof(void*)); } ((void**)arr_push_2->ptr)[arr_push_2->length++] = (void*)(intptr_t)40; arr_push_2->length; });
    printf((yu_string){(char*)"Final length: %d
", 17}, arr.length);
    printf((yu_string){(char*)"arr[0] = %d
", 12}, ((void**)arr.ptr)[0]);
    printf((yu_string){(char*)"arr[2] = %d
", 12}, ((void**)arr.ptr)[2]);
    printf((yu_string){(char*)"arr[3] = %d
", 12}, ((void**)arr.ptr)[3]);
    return 0;
}

int main(int argc, char** argv) {
    GC_init();
    yu_uv_init();
    yu_array args;
    args.length = argc;
    args.capacity = argc;
    args.ptr = GC_malloc(sizeof(yu_string) * argc);
    for (int i = 0; i < argc; i++) {
        ((yu_string*)args.ptr)[i] = (yu_string){argv[i], (int64_t)strlen(argv[i])};
    }
    yu_main(args);
    return yu_uv_run();
}
