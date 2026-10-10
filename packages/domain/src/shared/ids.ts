/**
 * ID は永続化層（Convex）が払い出す文字列。ドメインでは不透明な文字列として扱う。
 * 業務上の旧 ID（legacyId）と内部 ID は別フィールドで持ち、混同しない。
 */
export type WorkId = string;
export type RevisionId = string;
export type ArtifactId = string;
export type ThreadId = string;
export type UserId = string;
export type GroupId = string;
