# Standalone on purpose: no node-gyp, no package, nothing the Next.js build or
# the container image depends on. `make` should work on a clean checkout with
# only a C++17 compiler present.

CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion
BIN      := dupscan

all: $(BIN)

$(BIN): dupscan.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

test: $(BIN)
	./test.sh

clean:
	rm -f $(BIN)

.PHONY: all test clean
