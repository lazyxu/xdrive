//go:build ignore

// Resize the already generated xDrive PNG with only the Go standard library.
// This keeps the SPK icon derived from the same master used by Web/Desktop.
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
)

func create(input image.Image, output string, size int) error {
	b := input.Bounds()
	if b.Dx() < size || b.Dy() < size {
		return fmt.Errorf("source too small for %dx%d", size, size)
	}
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			x0, x1 := x*b.Dx()/size, (x+1)*b.Dx()/size
			y0, y1 := y*b.Dy()/size, (y+1)*b.Dy()/size
			var r, g, bl, a uint64
			var n uint64
			for iy := y0; iy < y1; iy++ {
				for ix := x0; ix < x1; ix++ {
					cr, cg, cb, ca := input.At(b.Min.X+ix, b.Min.Y+iy).RGBA()
					r += uint64(cr)
					g += uint64(cg)
					bl += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			out.SetRGBA(x, y, color.RGBA{uint8((r / n) >> 8), uint8((g / n) >> 8), uint8((bl / n) >> 8), uint8((a / n) >> 8)})
		}
	}
	f, err := os.Create(output)
	if err != nil {
		return err
	}
	if err := png.Encode(f, out); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func main() {
	if len(os.Args) != 4 && len(os.Args) != 3 {
		panic("usage: icon.png 64.png 256.png | icon.png dsm-ui-icon-dir")
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	src, err := png.Decode(f)
	_ = f.Close()
	if err != nil {
		panic(err)
	}
	if len(os.Args) == 3 {
		// DSM application config uses images/icon_{0}.png for all seven
		// documented sizes. Reuse the existing pixel-averaging algorithm.
		if err := os.MkdirAll(os.Args[2], 0755); err != nil {
			panic(err)
		}
		for _, size := range []int{16, 24, 32, 48, 64, 72, 256} {
			name := fmt.Sprintf("%s/icon_%d.png", os.Args[2], size)
			if err := create(src, name, size); err != nil {
				panic(err)
			}
		}
		return
	}
	if err := create(src, os.Args[2], 64); err != nil {
		panic(err)
	}
	if err := create(src, os.Args[3], 256); err != nil {
		panic(err)
	}
}
