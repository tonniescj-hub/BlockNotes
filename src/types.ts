export type Doc={type:string;text?:string;attrs?:Record<string,unknown>;marks?:{type:string;attrs?:Record<string,unknown>}[];content?:Doc[]}
export type Note={id:string;title:string;doc:Doc;plain:string;tags:string[];shelfId:string;status:'active'|'archived'|'deleted';previousStatus:'active'|'archived';revision:number;createdAt:string;updatedAt:string}
export type Shelf={id:string;name:string;color:string}
export type Snapshot={documents:ReadingDocument[];notes:Note[];shelves:Shelf[];settings:{parallax?:number;lastNoteId?:string;soundVolume?:number;musicVolume?:number;musicTrack?:string};dataPath:string;backupWarning?:string}
export type ResourceState={ready:boolean;busy:boolean;phase:string;done:number;total:number;error:string}
export type ReadingPosition={page:number;offset:number;block?:string}
export type ReadingAnchor={page:number;block?:string;start?:number;end?:number;rects:number[][]}
export type ReadingAnnotation={id:string;documentId:string;quote:string;comment:string;anchor:ReadingAnchor;revision:number;createdAt:string}
export type ReadingDocument={id:string;title:string;kind:'pdf'|'docx';shelfId:string;tags:string[];status:Note['status'];previousStatus:'active'|'archived';revision:number;pageCount:number;size:number;hash:string;createdAt:string;updatedAt:string;lastReadAt:string|null;position:ReadingPosition;warnings:string[]}
export type ReadingDetail=ReadingDocument&{html?:string;pages:string[];outline:{title:string;page:number;block?:string}[];annotations:ReadingAnnotation[]}
declare global {interface Window {blocknotes?:{call:(operation:string,input?:unknown)=>Promise<any>;onResources:(cb:(state:ResourceState)=>void)=>()=>void;onClose:(cb:()=>void)=>()=>void;readyToClose:()=>void}}}
