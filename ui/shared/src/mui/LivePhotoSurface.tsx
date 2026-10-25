import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent, ReactNode, WheelEvent } from 'react'
import { Box, Chip, CircularProgress } from '@mui/material'
import { XDriveMediaLoadingProgress } from './MediaLoadProgress'
import { xDriveAnchorPreviewZoom, xDriveClampPreviewViewport } from '../file-preview-viewport'
import type { XDrivePreviewPoint, XDrivePreviewViewport, XDrivePreviewImageDimensions } from '../file-preview-viewport'
import type {
  XDriveByteProgressHandler,
  XDriveLivePhotoMotionSource,
} from '../file-preview'

const XDRIVE_SF_LIVEPHOTO_PATH = "M 35.53515625,23.41796875 Q 30.916015625,23.41796875 26.8984375,25.1259765625 Q 22.880859375,26.833984375 19.8515625,29.86328125 Q 16.822265625,32.892578125 15.1142578125,36.91015625 Q 13.40625,40.927734375 13.40625,45.546875 Q 13.40625,50.14453125 15.1142578125,54.1513671875 Q 16.822265625,58.158203125 19.8515625,61.208984375 Q 22.880859375,64.259765625 26.8984375,65.9677734375 Q 30.916015625,67.67578125 35.53515625,67.67578125 Q 40.111328125,67.67578125 44.1181640625,65.95703125 Q 48.125,64.23828125 51.1650390625,61.1875 Q 54.205078125,58.13671875 55.9345703125,54.1298828125 Q 57.6640625,50.123046875 57.6640625,45.546875 Q 57.6640625,40.94921875 55.9453125,36.931640625 Q 54.2265625,32.9140625 51.1865234375,29.884765625 Q 48.146484375,26.85546875 44.12890625,25.13671875 Q 40.111328125,23.41796875 35.53515625,23.41796875 Z M 35.53515625,25.888671875 Q 39.6171875,25.888671875 43.18359375,27.4033203125 Q 46.75,28.91796875 49.45703125,31.625 Q 52.1640625,34.33203125 53.689453125,37.8984375 Q 55.21484375,41.46484375 55.21484375,45.546875 Q 55.21484375,49.62890625 53.6787109375,53.1953125 Q 52.142578125,56.76171875 49.435546875,59.46875 Q 46.728515625,62.17578125 43.162109375,63.701171875 Q 39.595703125,65.2265625 35.53515625,65.2265625 Q 31.453125,65.2265625 27.8759765625,63.701171875 Q 24.298828125,62.17578125 21.6025390625,59.4794921875 Q 18.90625,56.783203125 17.380859375,53.216796875 Q 15.85546875,49.650390625 15.85546875,45.546875 Q 15.85546875,41.443359375 17.3701171875,37.8662109375 Q 18.884765625,34.2890625 21.5810546875,31.603515625 Q 24.27734375,28.91796875 27.84375,27.4033203125 Q 31.41015625,25.888671875 35.53515625,25.888671875 Z M 35.53515625,73.412109375 Q 34.9765625,73.412109375 34.5791015625,73.798828125 Q 34.181640625,74.185546875 34.181640625,74.765625 Q 34.181640625,75.32421875 34.5791015625,75.7109375 Q 34.9765625,76.09765625 35.53515625,76.09765625 Q 36.09375,76.09765625 36.48046875,75.7109375 Q 36.8671875,75.32421875 36.8671875,74.765625 Q 36.8671875,74.185546875 36.48046875,73.798828125 Q 36.09375,73.412109375 35.53515625,73.412109375 Z M 40.626953125,72.9609375 Q 40.046875,72.9609375 39.66015625,73.34765625 Q 39.2734375,73.734375 39.2734375,74.29296875 Q 39.2734375,74.8515625 39.66015625,75.2490234375 Q 40.046875,75.646484375 40.626953125,75.646484375 Q 41.185546875,75.646484375 41.572265625,75.2490234375 Q 41.958984375,74.8515625 41.958984375,74.29296875 Q 41.958984375,73.734375 41.572265625,73.34765625 Q 41.185546875,72.9609375 40.626953125,72.9609375 Z M 45.525390625,71.650390625 Q 44.966796875,71.650390625 44.580078125,72.037109375 Q 44.193359375,72.423828125 44.193359375,72.982421875 Q 44.193359375,73.5625 44.580078125,73.94921875 Q 44.966796875,74.3359375 45.525390625,74.3359375 Q 46.10546875,74.3359375 46.4921875,73.94921875 Q 46.87890625,73.5625 46.87890625,72.982421875 Q 46.87890625,72.423828125 46.4921875,72.037109375 Q 46.10546875,71.650390625 45.525390625,71.650390625 Z M 50.166015625,69.458984375 Q 49.607421875,69.458984375 49.2099609375,69.845703125 Q 48.8125,70.232421875 48.8125,70.791015625 Q 48.8125,71.37109375 49.2099609375,71.7578125 Q 49.607421875,72.14453125 50.166015625,72.14453125 Q 50.724609375,72.14453125 51.111328125,71.7578125 Q 51.498046875,71.37109375 51.498046875,70.791015625 Q 51.498046875,70.232421875 51.111328125,69.845703125 Q 50.724609375,69.458984375 50.166015625,69.458984375 Z M 54.333984375,66.537109375 Q 53.775390625,66.537109375 53.3779296875,66.9345703125 Q 52.98046875,67.33203125 52.98046875,67.890625 Q 52.98046875,68.44921875 53.3779296875,68.8359375 Q 53.775390625,69.22265625 54.333984375,69.22265625 Q 54.892578125,69.22265625 55.2900390625,68.8359375 Q 55.6875,68.44921875 55.6875,67.890625 Q 55.6875,67.33203125 55.2900390625,66.9345703125 Q 54.892578125,66.537109375 54.333984375,66.537109375 Z M 57.943359375,62.94921875 Q 57.384765625,62.94921875 56.998046875,63.3359375 Q 56.611328125,63.72265625 56.611328125,64.28125 Q 56.611328125,64.861328125 56.998046875,65.248046875 Q 57.384765625,65.634765625 57.943359375,65.634765625 Q 58.5234375,65.634765625 58.91015625,65.248046875 Q 59.296875,64.861328125 59.296875,64.28125 Q 59.296875,63.72265625 58.91015625,63.3359375 Q 58.5234375,62.94921875 57.943359375,62.94921875 Z M 60.865234375,58.759765625 Q 60.306640625,58.759765625 59.919921875,59.146484375 Q 59.533203125,59.533203125 59.533203125,60.091796875 Q 59.533203125,60.650390625 59.919921875,61.0478515625 Q 60.306640625,61.4453125 60.865234375,61.4453125 Q 61.423828125,61.4453125 61.8212890625,61.0478515625 Q 62.21875,60.650390625 62.21875,60.091796875 Q 62.21875,59.533203125 61.8212890625,59.146484375 Q 61.423828125,58.759765625 60.865234375,58.759765625 Z M 63.013671875,54.140625 Q 62.455078125,54.140625 62.0576171875,54.52734375 Q 61.66015625,54.9140625 61.66015625,55.494140625 Q 61.66015625,56.052734375 62.0576171875,56.439453125 Q 62.455078125,56.826171875 63.013671875,56.826171875 Q 63.572265625,56.826171875 63.9697265625,56.439453125 Q 64.3671875,56.052734375 64.3671875,55.494140625 Q 64.3671875,54.9140625 63.9697265625,54.52734375 Q 63.572265625,54.140625 63.013671875,54.140625 Z M 64.32421875,49.2421875 Q 63.765625,49.2421875 63.3681640625,49.62890625 Q 62.970703125,50.015625 62.970703125,50.595703125 Q 62.970703125,51.154296875 63.3681640625,51.541015625 Q 63.765625,51.927734375 64.32421875,51.927734375 Q 64.8828125,51.927734375 65.2802734375,51.541015625 Q 65.677734375,51.154296875 65.677734375,50.595703125 Q 65.677734375,50.015625 65.2802734375,49.62890625 Q 64.8828125,49.2421875 64.32421875,49.2421875 Z M 64.75390625,44.21484375 Q 64.1953125,44.21484375 63.80859375,44.6015625 Q 63.421875,44.98828125 63.421875,45.546875 Q 63.421875,46.126953125 63.80859375,46.513671875 Q 64.1953125,46.900390625 64.75390625,46.900390625 Q 65.3125,46.900390625 65.7099609375,46.513671875 Q 66.107421875,46.126953125 66.107421875,45.546875 Q 66.107421875,44.98828125 65.7099609375,44.6015625 Q 65.3125,44.21484375 64.75390625,44.21484375 Z M 64.32421875,39.1875 Q 63.765625,39.1875 63.3681640625,39.57421875 Q 62.970703125,39.9609375 62.970703125,40.51953125 Q 62.970703125,41.078125 63.3681640625,41.4755859375 Q 63.765625,41.873046875 64.32421875,41.873046875 Q 64.8828125,41.873046875 65.2802734375,41.4755859375 Q 65.677734375,41.078125 65.677734375,40.51953125 Q 65.677734375,39.9609375 65.2802734375,39.57421875 Q 64.8828125,39.1875 64.32421875,39.1875 Z M 63.013671875,34.267578125 Q 62.455078125,34.267578125 62.0576171875,34.6650390625 Q 61.66015625,35.0625 61.66015625,35.62109375 Q 61.66015625,36.1796875 62.0576171875,36.5771484375 Q 62.455078125,36.974609375 63.013671875,36.974609375 Q 63.572265625,36.974609375 63.9697265625,36.5771484375 Q 64.3671875,36.1796875 64.3671875,35.62109375 Q 64.3671875,35.0625 63.9697265625,34.6650390625 Q 63.572265625,34.267578125 63.013671875,34.267578125 Z M 60.865234375,29.669921875 Q 60.306640625,29.669921875 59.919921875,30.056640625 Q 59.533203125,30.443359375 59.533203125,31.0234375 Q 59.533203125,31.58203125 59.919921875,31.96875 Q 60.306640625,32.35546875 60.865234375,32.35546875 Q 61.423828125,32.35546875 61.8212890625,31.96875 Q 62.21875,31.58203125 62.21875,31.0234375 Q 62.21875,30.443359375 61.8212890625,30.056640625 Q 61.423828125,29.669921875 60.865234375,29.669921875 Z M 57.943359375,25.48046875 Q 57.384765625,25.48046875 56.998046875,25.8671875 Q 56.611328125,26.25390625 56.611328125,26.8125 Q 56.611328125,27.392578125 56.998046875,27.779296875 Q 57.384765625,28.166015625 57.943359375,28.166015625 Q 58.5234375,28.166015625 58.91015625,27.779296875 Q 59.296875,27.392578125 59.296875,26.8125 Q 59.296875,26.25390625 58.91015625,25.8671875 Q 58.5234375,25.48046875 57.943359375,25.48046875 Z M 54.333984375,21.87109375 Q 53.775390625,21.87109375 53.3779296875,22.2578125 Q 52.98046875,22.64453125 52.98046875,23.224609375 Q 52.98046875,23.783203125 53.3779296875,24.169921875 Q 53.775390625,24.556640625 54.333984375,24.556640625 Q 54.892578125,24.556640625 55.2900390625,24.169921875 Q 55.6875,23.783203125 55.6875,23.224609375 Q 55.6875,22.64453125 55.2900390625,22.2578125 Q 54.892578125,21.87109375 54.333984375,21.87109375 Z M 50.166015625,18.970703125 Q 49.607421875,18.970703125 49.2099609375,19.357421875 Q 48.8125,19.744140625 48.8125,20.302734375 Q 48.8125,20.8828125 49.2099609375,21.26953125 Q 49.607421875,21.65625 50.166015625,21.65625 Q 50.724609375,21.65625 51.111328125,21.26953125 Q 51.498046875,20.8828125 51.498046875,20.302734375 Q 51.498046875,19.744140625 51.111328125,19.357421875 Q 50.724609375,18.970703125 50.166015625,18.970703125 Z M 45.525390625,16.779296875 Q 44.966796875,16.779296875 44.580078125,17.166015625 Q 44.193359375,17.552734375 44.193359375,18.111328125 Q 44.193359375,18.69140625 44.580078125,19.078125 Q 44.966796875,19.46484375 45.525390625,19.46484375 Q 46.10546875,19.46484375 46.4921875,19.078125 Q 46.87890625,18.69140625 46.87890625,18.111328125 Q 46.87890625,17.552734375 46.4921875,17.166015625 Q 46.10546875,16.779296875 45.525390625,16.779296875 Z M 40.626953125,15.46875 Q 40.046875,15.46875 39.66015625,15.85546875 Q 39.2734375,16.2421875 39.2734375,16.80078125 Q 39.2734375,17.380859375 39.66015625,17.767578125 Q 40.046875,18.154296875 40.626953125,18.154296875 Q 41.185546875,18.154296875 41.572265625,17.767578125 Q 41.958984375,17.380859375 41.958984375,16.80078125 Q 41.958984375,16.2421875 41.572265625,15.85546875 Q 41.185546875,15.46875 40.626953125,15.46875 Z M 35.53515625,15.017578125 Q 34.9765625,15.017578125 34.5791015625,15.404296875 Q 34.181640625,15.791015625 34.181640625,16.349609375 Q 34.181640625,16.908203125 34.5791015625,17.3056640625 Q 34.9765625,17.703125 35.53515625,17.703125 Q 36.09375,17.703125 36.48046875,17.3056640625 Q 36.8671875,16.908203125 36.8671875,16.349609375 Q 36.8671875,15.791015625 36.48046875,15.404296875 Q 36.09375,15.017578125 35.53515625,15.017578125 Z M 30.443359375,15.46875 Q 29.884765625,15.46875 29.4873046875,15.85546875 Q 29.08984375,16.2421875 29.08984375,16.80078125 Q 29.08984375,17.380859375 29.4873046875,17.767578125 Q 29.884765625,18.154296875 30.443359375,18.154296875 Q 31.001953125,18.154296875 31.388671875,17.767578125 Q 31.775390625,17.380859375 31.775390625,16.80078125 Q 31.775390625,16.2421875 31.388671875,15.85546875 Q 31.001953125,15.46875 30.443359375,15.46875 Z M 25.5234375,16.779296875 Q 24.96484375,16.779296875 24.578125,17.166015625 Q 24.19140625,17.552734375 24.19140625,18.111328125 Q 24.19140625,18.69140625 24.578125,19.078125 Q 24.96484375,19.46484375 25.5234375,19.46484375 Q 26.103515625,19.46484375 26.490234375,19.078125 Q 26.876953125,18.69140625 26.876953125,18.111328125 Q 26.876953125,17.552734375 26.490234375,17.166015625 Q 26.103515625,16.779296875 25.5234375,16.779296875 Z M 20.904296875,18.970703125 Q 20.32421875,18.970703125 19.9375,19.357421875 Q 19.55078125,19.744140625 19.55078125,20.302734375 Q 19.55078125,20.8828125 19.9375,21.26953125 Q 20.32421875,21.65625 20.904296875,21.65625 Q 21.462890625,21.65625 21.849609375,21.26953125 Q 22.236328125,20.8828125 22.236328125,20.302734375 Q 22.236328125,19.744140625 21.849609375,19.357421875 Q 21.462890625,18.970703125 20.904296875,18.970703125 Z M 16.736328125,21.87109375 Q 16.15625,21.87109375 15.76953125,22.2578125 Q 15.3828125,22.64453125 15.3828125,23.224609375 Q 15.3828125,23.783203125 15.76953125,24.169921875 Q 16.15625,24.556640625 16.736328125,24.556640625 Q 17.294921875,24.556640625 17.681640625,24.169921875 Q 18.068359375,23.783203125 18.068359375,23.224609375 Q 18.068359375,22.64453125 17.681640625,22.2578125 Q 17.294921875,21.87109375 16.736328125,21.87109375 Z M 13.10546875,25.48046875 Q 12.546875,25.48046875 12.16015625,25.8671875 Q 11.7734375,26.25390625 11.7734375,26.8125 Q 11.7734375,27.392578125 12.16015625,27.779296875 Q 12.546875,28.166015625 13.10546875,28.166015625 Q 13.685546875,28.166015625 14.072265625,27.779296875 Q 14.458984375,27.392578125 14.458984375,26.8125 Q 14.458984375,26.25390625 14.072265625,25.8671875 Q 13.685546875,25.48046875 13.10546875,25.48046875 Z M 10.18359375,29.669921875 Q 9.625,29.669921875 9.23828125,30.056640625 Q 8.8515625,30.443359375 8.8515625,31.0234375 Q 8.8515625,31.58203125 9.23828125,31.96875 Q 9.625,32.35546875 10.18359375,32.35546875 Q 10.763671875,32.35546875 11.150390625,31.96875 Q 11.537109375,31.58203125 11.537109375,31.0234375 Q 11.537109375,30.443359375 11.150390625,30.056640625 Q 10.763671875,29.669921875 10.18359375,29.669921875 Z M 8.056640625,34.267578125 Q 7.4765625,34.267578125 7.08984375,34.6650390625 Q 6.703125,35.0625 6.703125,35.62109375 Q 6.703125,36.1796875 7.08984375,36.5771484375 Q 7.4765625,36.974609375 8.056640625,36.974609375 Q 8.615234375,36.974609375 9.001953125,36.5771484375 Q 9.388671875,36.1796875 9.388671875,35.62109375 Q 9.388671875,35.0625 9.001953125,34.6650390625 Q 8.615234375,34.267578125 8.056640625,34.267578125 Z M 6.74609375,39.1875 Q 6.166015625,39.1875 5.779296875,39.57421875 Q 5.392578125,39.9609375 5.392578125,40.51953125 Q 5.392578125,41.078125 5.779296875,41.4755859375 Q 6.166015625,41.873046875 6.74609375,41.873046875 Q 7.3046875,41.873046875 7.69140625,41.4755859375 Q 8.078125,41.078125 8.078125,40.51953125 Q 8.078125,39.9609375 7.69140625,39.57421875 Q 7.3046875,39.1875 6.74609375,39.1875 Z M 6.31640625,44.21484375 Q 5.736328125,44.21484375 5.349609375,44.6015625 Q 4.962890625,44.98828125 4.962890625,45.546875 Q 4.962890625,46.126953125 5.349609375,46.513671875 Q 5.736328125,46.900390625 6.31640625,46.900390625 Q 6.875,46.900390625 7.26171875,46.513671875 Q 7.6484375,46.126953125 7.6484375,45.546875 Q 7.6484375,44.98828125 7.26171875,44.6015625 Q 6.875,44.21484375 6.31640625,44.21484375 Z M 6.74609375,49.2421875 Q 6.166015625,49.2421875 5.779296875,49.62890625 Q 5.392578125,50.015625 5.392578125,50.595703125 Q 5.392578125,51.154296875 5.779296875,51.541015625 Q 6.166015625,51.927734375 6.74609375,51.927734375 Q 7.3046875,51.927734375 7.69140625,51.541015625 Q 8.078125,51.154296875 8.078125,50.595703125 Q 8.078125,50.015625 7.69140625,49.62890625 Q 7.3046875,49.2421875 6.74609375,49.2421875 Z M 8.056640625,54.140625 Q 7.4765625,54.140625 7.08984375,54.52734375 Q 6.703125,54.9140625 6.703125,55.494140625 Q 6.703125,56.052734375 7.08984375,56.439453125 Q 7.4765625,56.826171875 8.056640625,56.826171875 Q 8.615234375,56.826171875 9.001953125,56.439453125 Q 9.388671875,56.052734375 9.388671875,55.494140625 Q 9.388671875,54.9140625 9.001953125,54.52734375 Q 8.615234375,54.140625 8.056640625,54.140625 Z M 10.18359375,58.759765625 Q 9.625,58.759765625 9.23828125,59.146484375 Q 8.8515625,59.533203125 8.8515625,60.091796875 Q 8.8515625,60.650390625 9.23828125,61.0478515625 Q 9.625,61.4453125 10.18359375,61.4453125 Q 10.763671875,61.4453125 11.150390625,61.0478515625 Q 11.537109375,60.650390625 11.537109375,60.091796875 Q 11.537109375,59.533203125 11.150390625,59.146484375 Q 10.763671875,58.759765625 10.18359375,58.759765625 Z M 13.10546875,62.94921875 Q 12.546875,62.94921875 12.16015625,63.3359375 Q 11.7734375,63.72265625 11.7734375,64.28125 Q 11.7734375,64.861328125 12.16015625,65.248046875 Q 12.546875,65.634765625 13.10546875,65.634765625 Q 13.685546875,65.634765625 14.072265625,65.248046875 Q 14.458984375,64.861328125 14.458984375,64.28125 Q 14.458984375,63.72265625 14.072265625,63.3359375 Q 13.685546875,62.94921875 13.10546875,62.94921875 Z M 16.736328125,66.537109375 Q 16.15625,66.537109375 15.76953125,66.9345703125 Q 15.3828125,67.33203125 15.3828125,67.890625 Q 15.3828125,68.44921875 15.76953125,68.8359375 Q 16.15625,69.22265625 16.736328125,69.22265625 Q 17.294921875,69.22265625 17.681640625,68.8359375 Q 18.068359375,68.44921875 18.068359375,67.890625 Q 18.068359375,67.33203125 17.681640625,66.9345703125 Q 17.294921875,66.537109375 16.736328125,66.537109375 Z M 20.904296875,69.458984375 Q 20.32421875,69.458984375 19.9375,69.845703125 Q 19.55078125,70.232421875 19.55078125,70.791015625 Q 19.55078125,71.37109375 19.9375,71.7578125 Q 20.32421875,72.14453125 20.904296875,72.14453125 Q 21.462890625,72.14453125 21.849609375,71.7578125 Q 22.236328125,71.37109375 22.236328125,70.791015625 Q 22.236328125,70.232421875 21.849609375,69.845703125 Q 21.462890625,69.458984375 20.904296875,69.458984375 Z M 25.5234375,71.650390625 Q 24.96484375,71.650390625 24.578125,72.037109375 Q 24.19140625,72.423828125 24.19140625,72.982421875 Q 24.19140625,73.5625 24.578125,73.94921875 Q 24.96484375,74.3359375 25.5234375,74.3359375 Q 26.103515625,74.3359375 26.490234375,73.94921875 Q 26.876953125,73.5625 26.876953125,72.982421875 Q 26.876953125,72.423828125 26.490234375,72.037109375 Q 26.103515625,71.650390625 25.5234375,71.650390625 Z M 30.443359375,72.9609375 Q 29.884765625,72.9609375 29.4873046875,73.34765625 Q 29.08984375,73.734375 29.08984375,74.29296875 Q 29.08984375,74.8515625 29.4873046875,75.2490234375 Q 29.884765625,75.646484375 30.443359375,75.646484375 Q 31.001953125,75.646484375 31.388671875,75.2490234375 Q 31.775390625,74.8515625 31.775390625,74.29296875 Q 31.775390625,73.734375 31.388671875,73.34765625 Q 31.001953125,72.9609375 30.443359375,72.9609375 Z M 35.53515625,34.4609375 Q 33.21484375,34.4609375 31.216796875,35.3095703125 Q 29.21875,36.158203125 27.693359375,37.6728515625 Q 26.16796875,39.1875 25.3193359375,41.1962890625 Q 24.470703125,43.205078125 24.470703125,45.50390625 Q 24.470703125,47.802734375 25.330078125,49.8115234375 Q 26.189453125,51.8203125 27.7041015625,53.3349609375 Q 29.21875,54.849609375 31.2275390625,55.708984375 Q 33.236328125,56.568359375 35.53515625,56.568359375 Q 37.8125,56.568359375 39.8212890625,55.708984375 Q 41.830078125,54.849609375 43.3447265625,53.32421875 Q 44.859375,51.798828125 45.71875,49.80078125 Q 46.578125,47.802734375 46.578125,45.50390625 Q 46.578125,43.205078125 45.71875,41.20703125 Q 44.859375,39.208984375 43.3447265625,37.68359375 Q 41.830078125,36.158203125 39.8212890625,35.3095703125 Q 37.8125,34.4609375 35.53515625,34.4609375 Z M 35.53515625,39.037109375 Q 37.318359375,39.037109375 38.779296875,39.9072265625 Q 40.240234375,40.77734375 41.1103515625,42.2490234375 Q 41.98046875,43.720703125 41.98046875,45.50390625 Q 41.98046875,47.287109375 41.1103515625,48.748046875 Q 40.240234375,50.208984375 38.7685546875,51.08984375 Q 37.296875,51.970703125 35.53515625,51.970703125 Q 33.73046875,51.970703125 32.26953125,51.1005859375 Q 30.80859375,50.23046875 29.9384765625,48.7587890625 Q 29.068359375,47.287109375 29.068359375,45.50390625 Q 29.068359375,43.69921875 29.927734375,42.23828125 Q 30.787109375,40.77734375 32.2587890625,39.9072265625 Q 33.73046875,39.037109375 35.53515625,39.037109375 Z"

export function XDriveLivePhotoGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      data-xdrive-live-photo-glyph="sf-livephoto"
      viewBox="4.5 14.5 62 62"
      width={size}
      height={size}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <g
        fill="currentColor"
        fillRule="nonzero"
        stroke="currentColor"
        strokeWidth={1}
        transform="scale(1,-1) translate(0,-91.115234375)"
      >
        <path d={XDRIVE_SF_LIVEPHOTO_PATH} />
      </g>
    </svg>
  )
}

export type XDriveLivePhotoMotionLoader = (
  onProgress?: XDriveByteProgressHandler,
  signal?: AbortSignal,
) => Promise<XDriveLivePhotoMotionSource | null | undefined>

export type XDriveLivePhotoSurfaceProps = {
  still: ReactNode
  stillReady?: boolean
  loadMotion?: XDriveLivePhotoMotionLoader
  sourceKey?: string | number
  label?: string
  onSwipePrevious?: () => void
  onSwipeNext?: () => void
  deferTouchHold?: boolean
  interactiveImage?: boolean
}

function livePhotoMotionURL(value: XDriveLivePhotoMotionSource) {
  return typeof value === 'string' ? value : value.url
}

function disposeLivePhotoMotion(value: XDriveLivePhotoMotionSource) {
  if (typeof value !== 'string') {
    value.dispose?.()
    if (value.url.startsWith('blob:')) URL.revokeObjectURL(value.url)
    return
  }
  if (value.startsWith('blob:')) URL.revokeObjectURL(value)
}

function livePhotoProgressPercent(loadedBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (loadedBytes / totalBytes) * 100))
}

export function XDriveLivePhotoSurface({
  still,
  stillReady = true,
  loadMotion,
  sourceKey,
  label = '实况照片',
  onSwipePrevious,
  onSwipeNext,
  deferTouchHold = false,
  interactiveImage = false,
}: XDriveLivePhotoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const motionURLRef = useRef('')
  const motionSourceRef = useRef<XDriveLivePhotoMotionSource | null>(null)
  const loadGenerationRef = useRef(0)
  // Invalidate asynchronous HTMLMediaElement.play() completions on release,
  // a new hold, or a different still/source revision.
  const playbackAttemptRef = useRef(0)
  // play() resolving only means playback has started, not that a video frame
  // reached the compositor. Keep the decoded still visible until the first
  // real frame callback (or loaded-data fallback on older browsers).
  const acceptedPlayAttemptRef = useRef(0)
  const pendingVideoFrameRef = useRef<{ video: HTMLVideoElement; id: number } | null>(null)
  const cancelPendingVideoFrame = useCallback(() => {
    const pending = pendingVideoFrameRef.current
    pendingVideoFrameRef.current = null
    if (pending && typeof pending.video.cancelVideoFrameCallback === 'function') {
      pending.video.cancelVideoFrameCallback(pending.id)
    }
  }, [])
  const loadStartedRef = useRef(false)
  // A failed motion-ticket lookup must be retryable on a NEW explicit hold,
  // but never automatically retry while the finger remains down.
  const retryableMotionLoadRef = useRef(false)
  const motionLoadAttemptRef = useRef(0)
  // Keep the current source's ticket available for a quick release/re-hold,
  // but cancel it promptly when the Viewer source or Owner is invalidated.
  const pendingMotionControllerRef = useRef<AbortController | null>(null)
  const cancelPendingMotion = useCallback(() => {
    const controller = pendingMotionControllerRef.current
    pendingMotionControllerRef.current = null
    controller?.abort()
  }, [])
  const loadMotionRef = useRef(loadMotion)
  loadMotionRef.current = loadMotion
  const holdActiveRef = useRef(false)
  // Browsing viewports defer touch holds even at the first/last photo;
  // having no neighbor must not trigger motion for a short tap or swipe.
  const stillReadyRef = useRef(stillReady)
  stillReadyRef.current = stillReady
  const gestureSession = useMemo(() => ({}), [sourceKey])
  const gestureSessionRef = useRef(gestureSession)
  gestureSessionRef.current = gestureSession
  const touchGestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startedAt: number
    x: number
    y: number
    mode: 'pending' | 'holding' | 'swiping' | 'cancelled'
    held: boolean
    multi: boolean
    session: object
  } | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])
  const [motionURL, setMotionURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState<number | null>(null)
  const [motionBytes, setMotionBytes] = useState<{ loadedBytes: number; totalBytes?: number }>({ loadedBytes: 0 })
  const [bufferProgress, setBufferProgress] = useState<{ bufferedSeconds: number; bufferedStartSeconds?: number; durationSeconds?: number }>({ bufferedSeconds: 0 })
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  // One decoded still, one motion player: only transform the already-visible
  // still. This reuses the ordinary image viewport math without new requests.
  const viewportElementRef = useRef<HTMLDivElement | null>(null)
  const viewportSizeRef = useRef({ width: 0, height: 0 })
  const imageDimensionsRef = useRef<XDrivePreviewImageDimensions | null>(null)
  const viewportRef = useRef<XDrivePreviewViewport>({ scale: 1, offset: { x: 0, y: 0 } })
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const zoomPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{
    distance: number
    scale: number
    offset: XDrivePreviewPoint
    anchor: XDrivePreviewPoint
  } | null>(null)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startedAt: number
    offset: XDrivePreviewPoint
    fromPinch?: boolean
  } | null>(null)
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const lastTouchZoomAtRef = useRef(0)

  const measureViewport = useCallback((element: HTMLDivElement | null = viewportElementRef.current) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return
    const rect = element.getBoundingClientRect()
    viewportSizeRef.current = { width: rect.width, height: rect.height }
    // The still's decoded image/canvas already exists. Never decode it again
    // to discover its aspect ratio, and never infer a Live pairing here.
    const canvas = element.querySelector?.('canvas')
    const image = element.querySelector?.('img:not([aria-hidden="true"])') as HTMLImageElement | null
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      imageDimensionsRef.current = { width: canvas.width, height: canvas.height }
    } else if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
      imageDimensionsRef.current = { width: image.naturalWidth, height: image.naturalHeight }
    }
  }, [])
  const imageAnchor = useCallback((element: HTMLDivElement, x: number, y: number): XDrivePreviewPoint => {
    measureViewport(element)
    const rect = element.getBoundingClientRect()
    return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 }
  }, [measureViewport])
  const applyImageViewport = useCallback((next: XDrivePreviewViewport) => {
    const size = viewportSizeRef.current
    // A still that hasn't reported dimensions yet cannot safely pan beyond
    // its painted rectangle. The next measure will refine the bounds.
    const dimensions = imageDimensionsRef.current ?? (
      size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null
    )
    const clamped = xDriveClampPreviewViewport(next, size, dimensions, 'contain')
    viewportRef.current = clamped
    setImageScale(clamped.scale)
    setImageOffset((current) =>
      current.x === clamped.offset.x && current.y === clamped.offset.y ? current : clamped.offset)
  }, [])
  const setImageZoom = useCallback((scale: number, anchor: XDrivePreviewPoint) => {
    const nextScale = Math.max(1, Math.min(6, Math.round(scale * 100) / 100))
    applyImageViewport(xDriveAnchorPreviewZoom(viewportRef.current, nextScale, anchor))
  }, [applyImageViewport])
  useLayoutEffect(() => {
    if (!interactiveImage || !viewportElementRef.current) return
    const element = viewportElementRef.current
    const resize = () => {
      measureViewport(element)
      applyImageViewport(viewportRef.current)
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element)
    if (typeof window !== 'undefined') window.addEventListener('resize', resize)
    return () => {
      observer?.disconnect()
      if (typeof window !== 'undefined') window.removeEventListener('resize', resize)
    }
  }, [applyImageViewport, interactiveImage, measureViewport])
  useLayoutEffect(() => {
    // A new source/Owner must not show the previous still's zoom for a frame.
    viewportRef.current = { scale: 1, offset: { x: 0, y: 0 } }
    imageDimensionsRef.current = null
    zoomPointersRef.current.clear()
    pinchRef.current = null
    panRef.current = null
    lastTapRef.current = null
    lastTouchZoomAtRef.current = 0
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
  }, [gestureSession])
  useLayoutEffect(() => {
    // A decoded still can become ready after the component first mounts.
    // Measure its actual contain-fit pixels then reclamp the existing zoom
    // without triggering a new byte request, and do so after session reset.
    if (!interactiveImage || !stillReady || !viewportElementRef.current) return
    measureViewport(viewportElementRef.current)
    applyImageViewport(viewportRef.current)
  }, [applyImageViewport, gestureSession, interactiveImage, measureViewport, stillReady])
  const acceptTouchTap = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!interactiveImage || !stillReadyRef.current || gestureSessionRef.current !== gestureSession) return
    const now = Date.now(), previous = lastTapRef.current
    if (previous && now - previous.at <= 320 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32) {
      lastTapRef.current = null
      lastTouchZoomAtRef.current = now
      const anchor = imageAnchor(event.currentTarget, event.clientX, event.clientY)
      setImageZoom(viewportRef.current.scale > 1 ? 1 : 2, anchor)
    } else lastTapRef.current = { at: now, x: event.clientX, y: event.clientY }
  }, [gestureSession, imageAnchor, interactiveImage, setImageZoom])
  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!interactiveImage || !stillReadyRef.current ||
        gestureSessionRef.current !== gestureSession ||
        Date.now() - lastTouchZoomAtRef.current < 500) return
    const anchor = imageAnchor(event.currentTarget, event.clientX, event.clientY)
    setImageZoom(viewportRef.current.scale > 1 ? 1 : 2, anchor)
  }, [gestureSession, imageAnchor, interactiveImage, setImageZoom])
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!interactiveImage || !stillReadyRef.current || gestureSessionRef.current !== gestureSession) return
    event.preventDefault()
    const anchor = imageAnchor(event.currentTarget, event.clientX, event.clientY)
    setImageZoom(viewportRef.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), anchor)
  }, [gestureSession, imageAnchor, interactiveImage, setImageZoom])

  const stopPlayback = useCallback(() => {
    playbackAttemptRef.current += 1
    acceptedPlayAttemptRef.current = 0
    cancelPendingVideoFrame()
    const video = videoRef.current
    if (video) {
      video.pause()
      try {
        video.currentTime = 0
      } catch {
        // Some runtimes reject seeks before metadata is available.
      }
    }
    setPlaying(false)
    setLoading(false)
  }, [cancelPendingVideoFrame])

  const playLoadedMotion = useCallback(() => {
    if (!motionURLRef.current || failed || !holdActiveRef.current) return
    const video = videoRef.current
    if (!video) return

    // pause() rejects an earlier pending play(). Fence that rejection before
    // it can turn a new press into a permanent "Live unavailable" state.
    const attempt = ++playbackAttemptRef.current
    acceptedPlayAttemptRef.current = 0
    cancelPendingVideoFrame()
    const generation = loadGenerationRef.current
    video.pause()
    try {
      video.currentTime = 0
    } catch {
      // The subsequent play() call will begin once enough metadata is available.
    }
    video.volume = 1
    // A resolved play() promise may precede the first presented frame.
    // Retain the still and bounded progress until frame presentation.
    setLoading(true)
    setPlaying(false)
    const isCurrentHold = () => (
      playbackAttemptRef.current === attempt &&
      loadGenerationRef.current === generation &&
      videoRef.current === video &&
      holdActiveRef.current
    )
    void video.play().then(() => {
      if (!isCurrentHold()) return
      acceptedPlayAttemptRef.current = attempt
      if (typeof video.requestVideoFrameCallback === 'function') {
        // This callback fires for an actual compositor-bound decoded frame.
        // A future release, re-hold or source change fences even a callback
        // that races cancelVideoFrameCallback().
        const id = video.requestVideoFrameCallback(() => {
          if (!isCurrentHold() || acceptedPlayAttemptRef.current !== attempt) return
          pendingVideoFrameRef.current = null
          setLoading(false)
          setPlaying(true)
        })
        pendingVideoFrameRef.current = { video, id }
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Older Safari/WebView runtimes lack requestVideoFrameCallback;
        // loaded-data readiness is the most conservative available signal.
        setLoading(false)
        setPlaying(true)
      }
    }).catch((error: unknown) => {
      if (!isCurrentHold()) return
      setLoading(false)
      setPlaying(false)
      // Safari's gesture gate and play/pause interruptions are retryable on
      // the next explicit hold; genuine decode/media failures remain terminal.
      if (error && typeof error === 'object' && 'name' in error && (
        error.name === 'AbortError' || error.name === 'NotAllowedError'
      )) return
      setFailed(true)
    })
  }, [cancelPendingVideoFrame, failed])

  const acceptFallbackVideoFrame = useCallback((video: HTMLVideoElement) => {
    if (typeof video.requestVideoFrameCallback === 'function' ||
        videoRef.current !== video || !holdActiveRef.current ||
        acceptedPlayAttemptRef.current === 0 ||
        acceptedPlayAttemptRef.current !== playbackAttemptRef.current ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    setLoading(false)
    setPlaying(true)
  }, [])

  const requestMotion = useCallback(() => {
    const loader = loadMotionRef.current
    // A genuine playback/codec failure remains terminal for this Viewer
    // source. A ticket lookup failure allows one fresh request per new hold.
    if (!loader || motionURLRef.current || (failed && !retryableMotionLoadRef.current)) return
    // Re-holding while the first signed-ticket request is in flight must
    // reuse that request, not issue duplicate authenticated calls.
    if (loadStartedRef.current) {
      setLoading(true)
      return
    }

    loadStartedRef.current = true
    retryableMotionLoadRef.current = false
    const generation = loadGenerationRef.current
    const attempt = ++motionLoadAttemptRef.current
    const controller = new AbortController()
    pendingMotionControllerRef.current = controller
    const isCurrentRequest = () => (
      !controller.signal.aborted &&
      loadGenerationRef.current === generation &&
      motionLoadAttemptRef.current === attempt &&
      loadStartedRef.current
    )
    setFailed(false)
    setLoading(true)
    setLoadProgress(null)
    setMotionBytes({ loadedBytes: 0 })
    setBufferProgress({ bufferedSeconds: 0 })

    const onProgress: XDriveByteProgressHandler = (loadedBytes, totalBytes) => {
      if (!isCurrentRequest()) return
      setLoadProgress(livePhotoProgressPercent(loadedBytes, totalBytes))
      setMotionBytes({ loadedBytes, totalBytes })
    }

    void loader(onProgress, controller.signal)
      .then((value) => {
        if (!value) {
          if (isCurrentRequest()) {
            loadStartedRef.current = false
            retryableMotionLoadRef.current = true
            setLoading(false)
            setFailed(true)
          }
          return
        }
        if (!isCurrentRequest()) {
          disposeLivePhotoMotion(value)
          return
        }
        const url = livePhotoMotionURL(value)
        if (!url) {
          disposeLivePhotoMotion(value)
          loadStartedRef.current = false
          retryableMotionLoadRef.current = true
          setLoading(false)
          setFailed(true)
          return
        }
        motionSourceRef.current = value
        motionURLRef.current = url
        setMotionURL(url)
      })
      .catch(() => {
        if (isCurrentRequest()) {
          loadStartedRef.current = false
          retryableMotionLoadRef.current = true
          setLoading(false)
          setFailed(true)
        }
      }).finally(() => {
        if (pendingMotionControllerRef.current === controller) {
          pendingMotionControllerRef.current = null
        }
      })
  }, [failed])

  const beginHold = useCallback(() => {
    if (!stillReady) return
    // Keyboard's explicit hold remains accessible while zoomed. Show the
    // unzoomed still before starting its native unzoomed video overlay.
    if (interactiveImage && viewportRef.current.scale > 1.01) {
      applyImageViewport({ scale: 1, offset: { x: 0, y: 0 } })
    }
    holdActiveRef.current = true
    if (motionURLRef.current) playLoadedMotion()
    else requestMotion()
  }, [applyImageViewport, interactiveImage, playLoadedMotion, requestMotion, stillReady])

  const endHold = useCallback(() => {
    holdActiveRef.current = false
    stopPlayback()
    // Loading an already-requested source may continue for reuse, but the
    // released still must not remain covered by a playback spinner.
    setLoading(false)
  }, [stopPlayback])

  useEffect(() => {
    if (motionURL && holdActiveRef.current && !failed) playLoadedMotion()
  }, [failed, motionURL, playLoadedMotion])

  // A still decoder failure or a recycled Viewer source revokes permission
  // to keep the associated motion playing. Do not leave audio/video active
  // underneath the newly unavailable still or automatically resume later.
  useEffect(() => {
    if (!stillReady) {
      clearHoldTimer()
      touchGestureRef.current = null
      zoomPointersRef.current.clear()
      pinchRef.current = null
      panRef.current = null
      lastTapRef.current = null
      if (viewportRef.current.scale !== 1) {
        applyImageViewport({ scale: 1, offset: { x: 0, y: 0 } })
      }
      holdActiveRef.current = false
      stopPlayback()
      cancelPendingMotion()
      motionLoadAttemptRef.current += 1
      loadStartedRef.current = false
      retryableMotionLoadRef.current = false
      setLoading(false)
    }
  }, [applyImageViewport, cancelPendingMotion, clearHoldTimer, stillReady, stopPlayback])

  useEffect(() => {
    clearHoldTimer()
    touchGestureRef.current = null
    return () => {
      clearHoldTimer()
      touchGestureRef.current = null
    }
  }, [clearHoldTimer, gestureSession])

  useEffect(() => {
    cancelPendingMotion()
    loadGenerationRef.current += 1
    motionLoadAttemptRef.current += 1
    loadStartedRef.current = false
    retryableMotionLoadRef.current = false
    holdActiveRef.current = false
    stopPlayback()

    const current = motionSourceRef.current
    motionSourceRef.current = null
    motionURLRef.current = ''
    setMotionURL('')
    setLoading(false)
    setLoadProgress(null)
    setFailed(false)
    if (current) disposeLivePhotoMotion(current)

    return () => {
      cancelPendingMotion()
      loadGenerationRef.current += 1
      holdActiveRef.current = false
      stopPlayback()
      const resolved = motionSourceRef.current
      motionSourceRef.current = null
      motionURLRef.current = ''
      if (resolved) disposeLivePhotoMotion(resolved)
    }
  }, [cancelPendingMotion, sourceKey, stopPlayback])

  const cancelTouchGesture = useCallback(() => {
    if (gestureSessionRef.current !== gestureSession) return
    clearHoldTimer()
    touchGestureRef.current = null
    zoomPointersRef.current.clear()
    pinchRef.current = null
    panRef.current = null
    lastTapRef.current = null
    endHold()
  }, [clearHoldTimer, endHold, gestureSession])
  const handleLostCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    // A normal pointerup loses capture too; keep the completed first tap so
    // the second touch can be recognized as a double-tap.
    if (zoomPointersRef.current.has(event.pointerId) ||
        touchGestureRef.current?.pointerId === event.pointerId) cancelTouchGesture()
  }, [cancelTouchGesture, gestureSession])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    if (interactiveImage && stillReadyRef.current && event.pointerType === 'touch') {
      zoomPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (zoomPointersRef.current.size >= 2) {
        clearHoldTimer()
        if (touchGestureRef.current) {
          touchGestureRef.current.multi = true
          touchGestureRef.current.mode = 'cancelled'
        }
        endHold()
        if (pendingMotionControllerRef.current) {
          // Pinching an actively loading Live clip must release its in-flight
          // motion ticket/Range instead of continuing a hidden download.
          cancelPendingMotion()
          motionLoadAttemptRef.current += 1
          loadStartedRef.current = false
          retryableMotionLoadRef.current = true
        }
        panRef.current = null
        lastTapRef.current = null
        const [first, second] = [...zoomPointersRef.current.values()]
        const midpoint = imageAnchor(event.currentTarget, (first.x + second.x) / 2, (first.y + second.y) / 2)
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          scale: viewportRef.current.scale,
          offset: { ...viewportRef.current.offset },
          anchor: midpoint,
        }
        return
      }
    }
    if (!event.isPrimary) {
      // A second finger must cancel a pending hold, not download motion.
      const gesture = touchGestureRef.current
      if (gesture) {
        gesture.multi = true
        gesture.mode = 'cancelled'
        clearHoldTimer()
        endHold()
      }
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; cancel/release still ends the hold.
    }
    // A zoomed still uses drag/pan, not a new Live motion request.
    if (interactiveImage && viewportRef.current.scale > 1.01) {
      clearHoldTimer()
      touchGestureRef.current = null
      panRef.current = {
        pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        startedAt: Date.now(), offset: { ...viewportRef.current.offset },
      }
      return
    }
    if (event.pointerType !== 'touch' || !deferTouchHold) {
      beginHold()
      return
    }
    clearHoldTimer()
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      x: event.clientX,
      y: event.clientY,
      mode: 'pending' as const,
      held: false,
      multi: false,
      session: gestureSession,
    }
    touchGestureRef.current = gesture
    // A touch becomes a manual Live hold only after remaining stationary.
    // Short tap/swipe/pinch never requests a motion ticket.
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      if (touchGestureRef.current !== gesture ||
          gestureSessionRef.current !== gesture.session ||
          gesture.mode !== 'pending' || gesture.multi || !stillReadyRef.current) return
      gesture.held = true
      touchGestureRef.current = { ...gesture, mode: 'holding' }
      beginHold()
    }, 260)
  }, [beginHold, cancelPendingMotion, clearHoldTimer, deferTouchHold, endHold, gestureSession, imageAnchor, interactiveImage])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    if (interactiveImage && event.pointerType === 'touch' &&
        zoomPointersRef.current.has(event.pointerId)) {
      zoomPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pinch = pinchRef.current
      if (pinch && zoomPointersRef.current.size === 2) {
        event.preventDefault()
        const [first, second] = [...zoomPointersRef.current.values()]
        const midpoint = imageAnchor(event.currentTarget, (first.x + second.x) / 2, (first.y + second.y) / 2)
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        const scale = Math.max(1, Math.min(6, Math.round(pinch.scale * distance / pinch.distance * 100) / 100))
        applyImageViewport(xDriveAnchorPreviewZoom(
          { scale: pinch.scale, offset: pinch.offset }, scale, pinch.anchor, midpoint))
        return
      }
    }
    const pan = panRef.current
    if (interactiveImage && pan?.pointerId === event.pointerId) {
      event.preventDefault()
      applyImageViewport({
        scale: viewportRef.current.scale,
        offset: {
          x: pan.offset.x + event.clientX - pan.startX,
          y: pan.offset.y + event.clientY - pan.startY,
        },
      })
      return
    }
    const gesture = touchGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId ||
        gesture.session !== gestureSessionRef.current) return
    gesture.x = event.clientX
    gesture.y = event.clientY
    const dx = gesture.x - gesture.startX
    const dy = gesture.y - gesture.startY
    if (Math.hypot(dx, dy) > 12) {
      clearHoldTimer()
      if (gesture.held) {
        gesture.mode = 'cancelled'
        endHold()
      } else if (gesture.mode === 'pending') {
        // A gesture starting vertically cannot later become a photo swipe.
        gesture.mode = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'swiping' : 'cancelled'
      }
    }
  }, [applyImageViewport, clearHoldTimer, endHold, gestureSession, imageAnchor, interactiveImage])

  const handlePointerRelease = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    const pinch = pinchRef.current
    const pinching = Boolean(interactiveImage && pinch && zoomPointersRef.current.has(event.pointerId))
    if (event.pointerType === 'touch') zoomPointersRef.current.delete(event.pointerId)
    const pan = panRef.current
    if (pinching || (interactiveImage && pan?.pointerId === event.pointerId)) {
      clearHoldTimer()
      touchGestureRef.current = null
      if (pinching) {
        pinchRef.current = null
        lastTapRef.current = null
        if (zoomPointersRef.current.size === 1) {
          const [pointerId, point] = [...zoomPointersRef.current.entries()][0]
          panRef.current = { pointerId, startX: point.x, startY: point.y,
            startedAt: Date.now(), offset: { ...viewportRef.current.offset }, fromPinch: true }
        }
      } else if (pan) {
        panRef.current = null
        if (event.pointerType === 'touch' && !pan.fromPinch &&
            Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) < 12 &&
            Date.now() - pan.startedAt <= 450) acceptTouchTap(event)
        else lastTapRef.current = null
      }
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch { /* Already released. */ }
      endHold()
      return
    }
    const gesture = touchGestureRef.current
    const current = Boolean(gesture && gesture.pointerId === event.pointerId &&
      gesture.session === gestureSessionRef.current)
    clearHoldTimer()
    if (current) touchGestureRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore runtimes that have already released the pointer.
    }
    endHold()
    if (!current || !gesture || gesture.held || gesture.multi || gesture.mode === 'cancelled') return
    if (interactiveImage && gesture.mode === 'pending' &&
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 12 &&
        Date.now() - gesture.startedAt <= 450) acceptTouchTap(event)
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    // Match ordinary images: only a brisk unzoomed horizontal swipe navigates.
    // Slow drags or post-pinch releases must remain on the current still.
    if (viewportRef.current.scale > 1.01 ||
        Date.now() - gesture.startedAt > 700 ||
        Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
    if (dx > 0) onSwipePrevious?.()
    else onSwipeNext?.()
  }, [acceptTouchTap, clearHoldTimer, endHold, gestureSession, interactiveImage, onSwipeNext, onSwipePrevious])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault()
      event.stopPropagation()
      beginHold()
    }
  }, [beginHold, gestureSession])

  const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current !== gestureSession) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      endHold()
    }
  }, [endHold, gestureSession])

  const statusLabel = failed ? '实况不可用' : '实况'

  return (
    <Box
      ref={viewportElementRef}
      role="button"
      tabIndex={0}
      data-xdrive-live-zoom={interactiveImage || undefined}
      data-xdrive-live-pinch={interactiveImage || undefined}
      aria-label={`${label}。按住播放，松开停止。${interactiveImage ? " 双指缩放、双击放大。" : ""}`}
      aria-pressed={playing}
      aria-busy={loading}
      aria-disabled={!stillReady || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerRelease}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onPointerCancel={cancelTouchGesture}
      onPointerLeave={cancelTouchGesture}
      onLostPointerCapture={handleLostCapture}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={cancelTouchGesture}
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: 'black',
        cursor: stillReady && loadMotion && !failed ? 'pointer' : 'default',
        userSelect: 'none',
        touchAction: interactiveImage ? 'none' : 'pan-y pinch-zoom',
        outline: 'none',
        '&:focus-visible': {
          boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
        },
        '& img': {
          objectFit: 'contain !important',
          pointerEvents: 'none',
          userSelect: 'none',
        },
      }}
    >
      <Box sx={{
        position: 'absolute', inset: 0,
        transform: interactiveImage
          ? `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})`
          : undefined,
        transformOrigin: 'center',
        transition: panRef.current || pinchRef.current ? 'none' : 'transform 100ms ease-out',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}>
        {still}
      </Box>

      {motionURL ? (
        <Box
          ref={videoRef}
          component="video"
          src={motionURL}
          controls={false}
          playsInline
          // A ticket resolved AFTER pointer-up must not start a new Range
          // read just because the video node mounts. Native play() still
          // controls Range buffering during an active press.
          preload={holdActiveRef.current && stillReady ? 'metadata' : 'none'}
          disablePictureInPicture
          onLoadedMetadata={(event) => {
            if (event.currentTarget !== videoRef.current || motionURLRef.current !== motionURL) return
            if (!holdActiveRef.current) setLoading(false)
          }}
          onLoadedData={(event) => {
            if (motionURLRef.current !== motionURL || !stillReady) return
            acceptFallbackVideoFrame(event.currentTarget)
          }}
          onCanPlay={(event) => {
            if (motionURLRef.current !== motionURL || !stillReady) return
            acceptFallbackVideoFrame(event.currentTarget)
          }}
          onTimeUpdate={(event) => {
            if (motionURLRef.current !== motionURL || !stillReady) return
            acceptFallbackVideoFrame(event.currentTarget)
          }}
          onProgress={(event) => {
            if (event.currentTarget !== videoRef.current || motionURLRef.current !== motionURL) return
            const video = event.currentTarget
            let bufferedSeconds = 0
            let bufferedStartSeconds: number | undefined
            for (let i = 0; i < video.buffered.length; i += 1) {
              const start = video.buffered.start(i), end = video.buffered.end(i)
              if (video.currentTime >= start && video.currentTime <= end) {
                bufferedSeconds = end
                bufferedStartSeconds = start
                break
              }
            }
            setBufferProgress({ bufferedSeconds, bufferedStartSeconds, durationSeconds:
              Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined })
          }}
          onEnded={(event) => {
            if (event.currentTarget !== videoRef.current || motionURLRef.current !== motionURL) return
            stopPlayback()
          }}
          onError={(event) => {
            // A released/old video request must not poison a newer Live Photo
            // or turn an idle still into a permanent "motion unavailable" tile.
            if (event.currentTarget !== videoRef.current || motionURLRef.current !== motionURL ||
              !holdActiveRef.current || !stillReady) return
            stopPlayback()
            setLoading(false)
            setFailed(true)
          }}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'contain',
            bgcolor: 'black',
            opacity: stillReady && playing ? 1 : 0,
            transition: 'opacity 120ms ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {stillReady ? <Chip
        size="small"
        icon={
          loading ? (
            <CircularProgress
              size={14}
              variant={loadProgress === null ? 'indeterminate' : 'determinate'}
              value={loadProgress ?? undefined}
            />
          ) : (
            <XDriveLivePhotoGlyph size={14} />
          )
        }
        label={statusLabel}
        sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          pointerEvents: 'none',
          bgcolor: 'rgba(0, 0, 0, 0.56)',
          color: 'common.white',
          backdropFilter: 'blur(8px)',
          '& .MuiChip-icon': { color: 'inherit' },
        }}
      /> : null}

      {loading ? (
        <XDriveMediaLoadingProgress
          stage={motionURL && loadProgress === null ? 'buffering' : 'transfer'}
          {...motionBytes}
          {...bufferProgress}
        />
      ) : null}

    </Box>
  )
}
