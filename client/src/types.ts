// Generated from shared/protocol/v1.schema.json; run scripts/generate-protocol.py.
export type Effect="ALLOW"|"DENY"|"INHERIT";
export type FeatureCapability="voice"|"screen_share"|"youtube_sync"|"server_files"|"remote_browser"|"chat";
export type Channel={id:string;parent_id:string|null;name:string;description:string;sort_order:number;max_users:number;audio_profile:"eco"|"standard"|"high";has_password:boolean;is_permanent:boolean;created_at:string;updated_at:string;};
export type User={id:string;fingerprint:string;nickname:string;channel_id:string;muted:boolean;deafened:boolean;server_muted:boolean;};
export type Role={id:string;name:string;protected:boolean;permissions:Record<string,Effect>;};
export type Snapshot={server:{id:string;name:string;bootstrap_available?:boolean;};self_id:string;channels:(Channel)[];users:(User)[];roles:(Role)[];permissions:Record<string,boolean>;channel_permissions:Record<string,Record<string,boolean>>;chat?:{enabled:boolean;history_enabled:boolean;max_message_length:number;messages_per_second:number;messages_per_minute:number;edits_per_minute:number;typing_per_second:number;channel_history_limit:number;private_history_limit:number;retention_days:number;max_stored_messages?:number;max_threads?:number;};screen?:{enabled:boolean;max_shares_per_channel:number;max_bitrate:number;max_height:number;max_fps:number;};};
export type Envelope={type:string;request_id?:string;event_id?:string;timestamp:string;payload:unknown;};
export type ChatMessage={id:string;thread_id:string;channel_id:string|null;author_fingerprint:string;author_nickname_snapshot:string;content:string;created_at:string;edited_at:string|null;deleted_at:string|null;reply_to_message_id:string|null;reply?:{id:string;nickname:string;content:string;deleted:boolean;};};
