module github.com/ComeHereToSee/typoza-client/helper

go 1.26.0

require github.com/ComeHereToSee/typoza-backend/sdk v0.0.0

require (
	github.com/coder/websocket v1.8.15 // indirect
	github.com/fsnotify/fsnotify v1.10.1 // indirect
	go.etcd.io/bbolt v1.5.0 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
	golang.org/x/text v0.43.0 // indirect
)

// 同步核心在私有的 typoza-backend 仓库里维护,CI 拉不到;用 scripts/vendor-sdk.sh 拷进来的副本
replace github.com/ComeHereToSee/typoza-backend/sdk => ./third_party/typoza-sdk
