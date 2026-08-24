// Bố cục/khám phá kênh state — ADR-0014. DTO qua biên Comlink, không type
// GramJS nào rò ra ngoài core-mtproto.

export interface StateChannelCandidate {
  id: string;
  accessHash: string;
  title: string;
  eventCount: number;
  updatedAt: number;
}

export type StateChannelChoice =
  | { kind: 'use'; channelId: string }
  | { kind: 'merge'; channelIds: string[] }
  | { kind: 'link'; link: string };

export interface StateChannelResolutionCallbacks {
  /**
   * Gọi khi dò thấy nhiều hơn một kênh state — ADR-0014 mục "Tìm thấy nhiều
   * hơn một". Không tự đoán; UI phải hỏi user.
   */
  chooseCandidate(candidates: StateChannelCandidate[]): Promise<StateChannelChoice>;
}
