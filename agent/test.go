package main

import (
	"fmt"
	"os"
)

func test() {
	name, err := os.Hostname()
	errorhandler(err)
	fmt.Println(name)
}
