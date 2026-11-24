// Package core is the part of Xray-core the Android app calls, bound with gomobile:
// gomobile bind -target=android -androidapi 21 -javapkg team.datacraft.dtclient ./
package core

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	xcore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

var (
	mu       sync.Mutex
	instance *xcore.Instance
)

// SetAssetDir tells Xray where geoip.dat and geosite.dat are.
func SetAssetDir(dir string) {
	os.Setenv("xray.location.asset", dir)
	os.Setenv("XRAY_LOCATION_ASSET", dir)
}

// Start runs the JSON configuration, replacing one already running.
func Start(configJSON string) error {
	mu.Lock()
	defer mu.Unlock()
	if instance != nil {
		instance.Close()
		instance = nil
	}
	config, err := serial.LoadJSONConfig(strings.NewReader(configJSON))
	if err != nil {
		return err
	}
	server, err := xcore.New(config)
	if err != nil {
		return err
	}
	if err := server.Start(); err != nil {
		server.Close()
		return err
	}
	instance = server
	return nil
}

func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if instance != nil {
		instance.Close()
		instance = nil
	}
}

func IsRunning() bool {
	mu.Lock()
	defer mu.Unlock()
	return instance != nil
}

func Version() string {
	return xcore.Version()
}

// MeasureDelay is the real delay of one outbound, as the panel's outbound test measures it: a separate
// Xray instance from configJSON (its first outbound is the one tested, no inbounds needed), and two
// requests for url over one connection dialled through it. It returns the second request's time in
// milliseconds (the first's when the second fails), or -1 when nothing answered within timeoutMs.
// The running connection's instance is not touched.
func MeasureDelay(configJSON string, url string, timeoutMs int) int64 {
	config, err := serial.LoadJSONConfig(strings.NewReader(configJSON))
	if err != nil {
		return -1
	}
	inst, err := xcore.New(config)
	if err != nil {
		return -1
	}
	if err := inst.Start(); err != nil {
		inst.Close()
		return -1
	}
	defer inst.Close()
	timeout := time.Duration(timeoutMs) * time.Millisecond
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dest, err := xnet.ParseDestination(network + ":" + addr)
			if err != nil {
				return nil, err
			}
			return xcore.Dial(ctx, inst, dest)
		},
		MaxIdleConns:        1,
		MaxIdleConnsPerHost: 1,
		IdleConnTimeout:     timeout,
		TLSHandshakeTimeout: timeout,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		// A redirect would dial again; the answer itself proves the way works.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	get := func() (int64, bool) {
		started := time.Now()
		resp, err := client.Get(url)
		if err != nil {
			return 0, false
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 256<<10))
		resp.Body.Close()
		return time.Since(started).Milliseconds(), true
	}
	cold, ok := get()
	if !ok {
		return -1
	}
	if warm, ok := get(); ok {
		return max(1, warm)
	}
	return max(1, cold)
}
