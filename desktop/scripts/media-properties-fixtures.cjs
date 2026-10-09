// Shared raw API goldens for M09 acceptance. These are transport data, not a
// second metadata formatter. Expected labels are intentionally explicit.
// The integrated Server LIVP contract exposes one original container plus
// two derived resources. Their sum is not the selected Node's size.
const stamp = '2026-10-09T00:00:00Z';
const rootNode = { id: 1, name: '我的文件', type: 'dir', size: 0, revision: 1, created_at: stamp, updated_at: stamp };
const parentNode = { id: 5, name: 'Properties 验收目录', parent_id: 1, type: 'dir', size: 0, revision: 1, created_at: stamp, updated_at: stamp };
const node = (id, name, revision, size) => ({ id, name, revision, size, parent_id: 5, type: 'file', created_at: stamp, updated_at: stamp });
const metadata = {
  media_kind: 'image', mime_type: 'image/png', index_state: 'ready', has_thumbnail: true,
  width: 4032, height: 3024, orientation: 6, captured_at: '2026-10-08T12:34:56Z',
  camera_make: 'Apple', camera_model: 'iPhone 15 Pro', lens_model: 'Wide Camera',
  latitude: 0, longitude: 103.812, altitude_m: 0,
  thumbnail_width: 384, thumbnail_height: 288, thumbnail_mime_type: 'image/png',
};
const organization = { favorite: true, tags: ['旅行', '亲友'], people: ['小明'], description: '海边。保留用户填写的原始备注；Properties 只展示已有事实。' };
const still = {
  node: node(101, 'M09-零纬度-富媒体照片.png', 7, 4096), metadata: { ...metadata },
  asset_kind: 'image', ...organization,
  resources: [{ kind: 'node', node_id: 101, role: 'primary', name: 'M09-零纬度-富媒体照片.png', media_kind: 'image', mime_type: 'image/png', size: 4096 }],
};
const video = {
  node: node(202, 'M09-视频编码与时长.mp4', 9, 32768),
  metadata: { ...metadata, media_kind: 'video', mime_type: 'video/mp4', width: 1920, height: 1080,
    duration_ms: 4829, frame_rate: 59.94, bit_rate: 12000000, video_codec: 'h264', audio_codec: 'aac', rotation_degrees: 90 },
  asset_kind: 'video', ...organization,
  resources: [{ kind: 'node', node_id: 202, role: 'primary', name: 'M09-视频编码与时长.mp4', media_kind: 'video', mime_type: 'video/mp4', size: 32768 }],
};
const live = {
  node: node(303, 'M09-原始容器与资源大小-拍摄时间未记录.livp', 11, 12288),
  metadata: { ...metadata, container_kind: 'livp', live_photo_asset_identifier: 'F187F3A1-0625-4908-AE8C-A83B037E06B0' },
  asset_kind: 'live_photo', live_photo: true, ...organization,
  resources: [
    { kind: 'node', node_id: 303, role: 'container', name: 'M09-原始容器与资源大小-拍摄时间未记录.livp', media_kind: 'other', mime_type: 'application/zip', size: 12288 },
    { kind: 'derived', node_id: 303, role: 'still', name: 'M09-静态照片-资源名称保持完整.png', media_kind: 'image', mime_type: 'image/png', size: 4096 },
    { kind: 'derived', node_id: 303, role: 'motion', name: 'M09-动态视频-最后一个原始资源.mp4', media_kind: 'video', mime_type: 'video/mp4', size: 8192 },
  ],
};
delete live.metadata.captured_at;
const commonFacts = [
  ['方向', '顺时针 90°'], ['相机', 'Apple iPhone 15 Pro'], ['镜头', 'Wide Camera'],
  ['GPS', '0.000000, 103.812000'], ['海拔', '0.0 m'],
];
const expected = {
  still: { info: [['类型', '图片'], ['拍摄时间', '2026/10/08 12:34:56'], ['分辨率', '4032 × 3024'], ...commonFacts],
    files: [['文件名', still.node.name], ['大小', '4 KiB'], ['格式', 'image/png'], ['缩略图', '384 × 288 · image/png']], resources: [] },
  video: { info: [['类型', '视频'], ['拍摄时间', '2026/10/08 12:34:56'], ['分辨率', '1920 × 1080'], ['方向', '顺时针 90°'],
    ['时长', '0:05'], ['视频旋转', '90°'], ['帧率', '59.94 fps'], ['码率', '12.00 Mbps'], ['视频编码', 'h264'], ['音频编码', 'aac'], ...commonFacts.slice(1)],
    files: [['文件名', video.node.name], ['大小', '32 KiB'], ['格式', 'video/mp4'], ['缩略图', '384 × 288 · image/png']], resources: [] },
  live: { info: [['类型', '实况照片'], ['拍摄时间', '未记录'], ['分辨率', '4032 × 3024'], ...commonFacts],
    files: [['文件名', live.node.name], ['大小', '12 KiB'], ['格式', 'image/png'], ['缩略图', '384 × 288 · image/png'], ['资源数', '3']],
    resources: [['原始容器', live.resources[0].name + ' · application/zip · 12 KiB'], ['静态照片', live.resources[1].name + ' · image/png · 4 KiB'], ['动态视频', live.resources[2].name + ' · video/mp4 · 8 KiB']] },
};
const deepFreeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
module.exports = deepFreeze({ stamp, rootNode, parentNode, items: { still, video, live }, expected });
