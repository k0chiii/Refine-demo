import type { ChannelAvailability } from "@mf100/domain";
import { availableChannels as availableOf, deliveryConfigFromEnv } from "../delivery/channels.ts";

/**
 * 秘密の揃った経路。通知の設定画面が「使える届け先」を出すのに引く。
 * 判定は配信（src/delivery/channels.ts）と同じ 1 か所に寄せてある（画面で使えると言った経路が、送るときに使えない食い違いを防ぐ）
 */
export const availableChannels = (env: Env): ChannelAvailability =>
  availableOf(deliveryConfigFromEnv(env));
