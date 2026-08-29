type ResizeCallback = (entry: ResizeObserverEntry) => void;

const callbacksByElement = new Map<Element, Set<ResizeCallback>>();
let sharedObserver: ResizeObserver | null = null;

function getSharedObserver(): ResizeObserver {
  sharedObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      callbacksByElement.get(entry.target)?.forEach((callback) => callback(entry));
    }
  });
  return sharedObserver;
}

/**
 * Đăng ký theo dõi resize của MỘT element qua MỘT `ResizeObserver` dùng
 * chung toàn app — tránh mỗi component tự `new ResizeObserver()` riêng (mỗi
 * instance có overhead quan sát/callback riêng của trình duyệt, không cần
 * thiết khi nhiều nơi cùng cần đo kích thước). Trả về hàm huỷ đăng ký; gọi
 * trong `DestroyRef.onDestroy()`.
 */
export function observeElementResize(element: Element, callback: ResizeCallback): () => void {
  const observer = getSharedObserver();
  let callbacks = callbacksByElement.get(element);
  if (!callbacks) {
    callbacks = new Set();
    callbacksByElement.set(element, callbacks);
    observer.observe(element);
  }
  callbacks.add(callback);

  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      callbacksByElement.delete(element);
      observer.unobserve(element);
    }
  };
}
