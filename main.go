package main

import (
	"embed"
	"flag"
	"log"

	"bomberman-dom/server"
)

//go:embed all:public
var publicAssets embed.FS

func main() {
	port := flag.String("port", "8080", "server port")
	flag.Parse()

	if err := server.Run(*port, publicAssets); err != nil {
		log.Fatal(err)
	}
}
