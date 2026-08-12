package main

import (
	"flag"
	"log"

	"bomberman-dom/server"
)

func main() {
	port := flag.String("port", "8080", "server port")
	flag.Parse()

	if err := server.Run(*port); err != nil {
		log.Fatal(err)
	}
}
