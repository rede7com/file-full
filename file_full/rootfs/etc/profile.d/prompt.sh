#!/bin/sh
# Sobrescreve o PS1 padrão do busybox ash, que usa o hostname gerado pelo
# Supervisor pro container (ex: "08a40d41-file-full") — não muito legível.
# Nome fixo aqui, sem depender do hostname real.
export PS1='file-full:\w\$ '
