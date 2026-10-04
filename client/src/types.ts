// Generated from shared/protocol/v1.schema.json; run scripts/generate-protocol.py.
export type Effect="ALLOW"|"DENY"|"INHERIT";
export type FeatureCapability="voice"|"screen_share"|"youtube_sync"|"server_files"|"remote_browser";
export type Channel={id:string;parent_id:string|null;name:string;description:string;sort_order:number;max_users:number;audio_profile:"eco"|"standard"|"high";has_password:boolean;is_permanent:boolean;created_at:string;updated_at:string;};
export type User={id:string;fingerprint:string;nickname:string;channel_id:string;muted:boolean;deafened:boolean;server_muted:boolean;};
export type Role={id:string;name:string;protected:boolean;permissions:Record<string,Effect>;};
export type Snapshot={server:{id:string;name:string;};self_id:string;channels:(Channel)[];users:(User)[];roles:(Role)[];permissions:Record<string,boolean>;channel_permissions:Record<string,Record<string,boolean>>;};
export type Envelope={type:string;request_id?:string;event_id?:string;timestamp:string;payload:unknown;};
