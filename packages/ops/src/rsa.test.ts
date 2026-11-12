/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Tests for the `rsa` vocabulary (vocab/rsa.fth). The vectors that come from independent tools (openssl dgst,
 * openssl pkeyutl, openssl pkcs8 and rsa for the keys) are in vocab/rsa.test.json. Here: the random parts, with the
 * random source pinned (the expected values were computed by a second implementation of RFC 8017 in Python that
 * uses only hashlib and pow, and each was then decrypted or verified by openssl); round trips against node:crypto
 * (OpenSSL) in both directions; the one-message rule of decryption errors; key files cut at every byte and mutated;
 * the effects; and the measured costs (VM steps and time) recorded in the README.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;

const K1024 =
  "-----BEGIN RSA PRIVATE KEY-----\nMIICWwIBAAKBgQC9JaaVS4wTGJqEKtdqPA5eshzjgZz0LH/MtGlTogD9gt6IzFk4\npGBFDE1V7YtnQF0WY9q5vXnKD/MGJsX3avJmq5HmvdpzTy8Us+IIQOMzoAZIAwr7\nsdX1HcXCVfYpRh6Ue/zcww8CQiDb38qt+jz+TEPUVabywyBg3oeKr4fLHwIDAQAB\nAoGAUWxHzbT706yft42Jtd2sge9CqF0/Z41QZpqzTKFMs9UGXvU44z0/g/nLwNXF\nUOlQKTdLDPIX33gGMfu29M9BEVtxC5WQ3tqJl8E7+X3yZKM1VyuQ4tUjAXIsRnn3\n7zbLr/TIw4X+Djkx91OTp2ohG3S0yADI3NZ82SITAkw66cECQQDuegecw5yWu/C1\nQ8yd2wX9afGm5kQyw8BMaN1Uor0VPaf8k3tZazFtoUoQf9IqcBWTD687k3MfkzTF\n4WkqVe9nAkEAywuvTYxmULXCqGE623Abufe/Nm5Eq/1ZP7mprRiJ7evcRNKHbS7B\n2Kuzln9aSgrs9CWxQ+HLNt01sDjpOyzLiQJAbQapOEhN7LPbpmNqxrh9ko+/BPi9\nMSBBaC2BEtKb83wOsvCSMh1Jqb9VZxmo8fHwSx2elXQh68uXEuis9cf3/QJAF0FF\nWKpl5YSLwOEx7oQOiOQZIFDMyK4BlMzc5BhVY8yJs9Aw9o5OYVR5Axme67AIp4XR\noaawsZ3wUjiSbdaZkQJADZ8CCFrFf8gv4OrBMUtiax3CUCwmr6rA4c57XLDDzxZl\n55jlFrqNbhlndAot21WKgcKOiJFqXP3mK6mOWXo5Zw==\n-----END RSA PRIVATE KEY-----\n";
const K2048 =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0zEldr+tJ6HK1FWQ49QTKg7uHUCc7IVSsf0heKkvwIsnUCu/\nUFztQYUSvxfOCFv2x6Smn3g27k8HtblOpqIplhKDAFueCVcyWQwe8zXVwyRaoOIF\n3bC9IITYVoYYvpkCdU1k09lRMg5gx1b1Pv9D8Fo3RZIIIivTnFPDUCKEoA6Aqejn\nXUgtjVzz0P7DgNUjrOCD936Y1QdMTaP+Y2PpddBHNxdVbvmqCdM0RHycaB/X4e5T\nigQqV9oWoMRuGWEUVKAYUmvLo/ZDHic2X0JqJKgVjsqImRZgZWpo+zG4JHa/1JUK\nosrAkLLSMLKWkLM0UpdagbKYw+A8omHRWFTf5wIDAQABAoIBAAdDx+4imdCky1b4\n7b41XvnLZnvkuE39wa9HVEEHHavNHZ6vlcOSu5Az0hLdifc8cp8oSTMJh5o0mo2w\n88VEcfnF/6U7gZKaSHkXsz9A7G5SCdJ1WlsatIBlEXjbraFtntAG+x9U3zfBltxE\nkxsfqZtsmKO9nXOcRLzT6zWoE+sNhKewgFoyPoeNxV3WCX/H5dGBkcndDpESttaB\nE0RG2vtOb7Kvnn6OUV2tPjR5cBkdy0vE7NeDfzU/mwvvRyynq5z9NlJc/8b79Qpo\nFyOdnix9D7W3V8eypqFa739dUp7RjAkO3Th6snM7Lr9chw/JZNxkDb+9/4J2YVt2\nbi2MKYECgYEA8EF97pgqE5ZoFo/vnPq31iZvAaabTou7nO3T54JGwlFUI1aXwsy6\njdMLT4y7i/U83Q7rDujXKNtgmpePs9Wtqj+tqarNQ/EUfPMoG9ycKpW0C7uU5Uf7\nnxu0Rr1EJG46Jpz381PfvwMkV0WaPwJvtdaMNUWmWmRQOeZ1UfA9/C8CgYEA4QgV\nBy4z0ltOPd3VcuZARzA1532IZZIB7esto860OIVYjSETVW4ZsO1azXLAugm/DKJL\ngs7sSba/8kbl4oQmZKWo1ecD2eo8hmYwh3djuoEkEpgWIG2JDGprXNkWmFQySBHb\nPhUmcvsFQwhWqKTsTPQJRGrci1txDZubdbBRUckCgYEAvJ39+uHVLrmHECeCKxCe\nYO6deYNOLFUBPotsMDWTzZxB3NhvnoxR7WQBXjuTRaaLWNUMbxEXUckgx10zgTDA\n/YaulSQ1sCBFQG85Tt5ccAZFamyi0Xo4rcn3Nw4BwEQVPRlAg/SWFQSndCh9lvgX\nsX81ZeE/X3mfjkVCV8ivMRsCgYAOrctJW58vwpr4+CZ7Rz+8JQ3vGsYx8fNERMoG\nXG5vHWuoURcExJjSbLk2m5ysxgP7W/7W+o55RH2C3VMTkpE6kX/Q7C/ZIClwjuvt\nekE8Ij5rJBaVaO++qpZ0SQjrSNq6zsdhZlnKuEsgk0Or3o43ete76ciXIpDeVV8v\nrx+u2QKBgBvW/4762yrM8uSCNDAqmVpMF/P0WriPfyJCXBoKFTEf6/d/GhDY942y\nY/WKzdMXqfwP9T3zdqsQoZife3gY+Kf7SWH/F3jaQhru9ZO72Fo03LV+OJqXDm/L\nEgLpE4JoHs+aoPnx8DSUmTEQ+TEhhXq24RG4Vi/iojQrnzZP3uVo\n-----END RSA PRIVATE KEY-----\n";
const K4096 =
  "-----BEGIN RSA PRIVATE KEY-----\n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\n2YZxAoIBAHmRmotriNxG+WjN5khuQn9fFeCq4C9sz9/7qRPPi3+zPm+HgEJmyZuJ\nA92HHzrgj1CJg47D/nadgSOVAX1DZV6d+qjqJ6R8U4l1TECwkutuatZXEcHO64QA\nl8FggM5Ij0h7SS5jl4ubfzTVlvOU84W1INtszZ2OMG4gtyXy87SiaJ/MNW2Jh8jK\n7qH9/FzXb2O459AoyXkFp3OUazwwVi0W7AGOT3Xk4OIdEaDOytl7EFWu2Za9C0XN\nJmZBRbCB8spyB9pLHx2bI2iZ49dSimZO5Vdv/VyHRSZHyM5tEk0dqMIWNnYykD1L\nmv4tC2x5e8JZDcfmJEDZgg14dGD9NrkCggEBAMdEEvnJEuPTjLfkQDPSj3qirL/g\nQ1jK+t8skYB2FKKtjBEDImScri2QxzDIaXi6fC4DbjgmGlspjpZvN5EAwnVdO+ZS\nhDZGxcDKFiM1ZlExWXWVDP9/KTXqzYNvKn5NydCKeXk1joRVdGTIglj7UGIWRBUT\nev4FziyhEw+SBf3LFihQ59dk51SSKTvmY6A1rEQjIfINkDDyDXIkXRRqFn5lak71\n5kQxMJvpSudQE+ieQY1+xJ06qESK9vXyS7VrecAYeFXofdbr1zoJddIINNcdWrJ5\nyyfa/v/QyaMvQBPasZ4TKGXTqcAbgFvYKRXlnA1hhYhn/4C9aV5Ysej+ts0=\n-----END RSA PRIVATE KEY-----\n";
const PUB2048 =
  "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0zEldr+tJ6HK1FWQ49QT\nKg7uHUCc7IVSsf0heKkvwIsnUCu/UFztQYUSvxfOCFv2x6Smn3g27k8HtblOpqIp\nlhKDAFueCVcyWQwe8zXVwyRaoOIF3bC9IITYVoYYvpkCdU1k09lRMg5gx1b1Pv9D\n8Fo3RZIIIivTnFPDUCKEoA6AqejnXUgtjVzz0P7DgNUjrOCD936Y1QdMTaP+Y2Pp\nddBHNxdVbvmqCdM0RHycaB/X4e5TigQqV9oWoMRuGWEUVKAYUmvLo/ZDHic2X0Jq\nJKgVjsqImRZgZWpo+zG4JHa/1JUKosrAkLLSMLKWkLM0UpdagbKYw+A8omHRWFTf\n5wIDAQAB\n-----END PUBLIC KEY-----\n";
const PINNED: Record<string, Record<string, string | number>> = {
  "oaep-SHA-1": {
    seed: "030a11181f262d343b424950575e656c737a8188",
    ct: "543505139612dabecf6187f0898071cdf9d24c9eb4920994a5f0da95173c39fe031bd0a810bfdac6f67027f1b176d0be2e2cb4890848ba7465f3a0fb15a270c4cb30f57f3475fa4ff87c2997edd01b44ba0e53485d3878220c5b77f1f47c103f73e415f2cf01fdfdf6a1994367ef9b81e43f10df227bd06febe2edebc0b153234bb32abb30e7ad19f769ecabf2be80548ba4d232bddb19bf994553dd743fe12aaf62407b3e3a6d4c3db627be78dacd8867dfdc7817ee306ee55dfded8ac6a722d7bb875c9187d512b62881a0d07cd470e4ea72e74af1f919d52aebfef73d4db0f95176ba70999f6e53afdf19dfaa3bfdad3abbc98d8451cfd1fa0959c1c247fc",
  },
  "oaep-MD5": {
    seed: "030a11181f262d343b424950575e656c",
    ct: "96cca7802ffca21ddf3ac3575678fa468e53535b0d2da70e4cbf293a16f4e18f7d47d1b4dd33035ec2e36966db2c3dae34fef28f059fa542ca2f005d7f911c1e40d57b61d454ba99df8453c31ad14e41ddc9d87dbfa0daae8cf30b9c22ef1c32a58720a0f160305cc6c07e02ac7ff3faecc6c0f71bcd438265004ca7cb3677a077ffd9866b7c45a8b581e3c1fe3482826efe0da49b847e11ccbaf1d56e567559b4891db72db3192750c869fb27a37d791112b5da2952facfd51d34ea688b9cb4bd19a11be6650fb149964f911fb03d6738a0e3469cb267e20c0f3d18fad0b82f4ab4c232eaec9ee62562c78292609a86bcd8c1ff31b53009c3f676ca63e495c3",
  },
  "oaep-SHA-256": {
    seed: "030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc",
    ct: "7b1953fd21b012c35f32f518918631ecbff1ff14da6b25c40cb083b7b09d77bf9541e485e11061d1d54bc37f5ebde8ea52e47bbe99c3e23edf7b96ded82c50da3c384415c3fe05a8bd52a3e89bbe85fb36e292335b32fc8b3d2db88f79f86a90b9e01e5793c9ce89c42254f582dd03b780cbbb4edbf8175140ff6c27622f9b3e27c23eb504cf3bf1e479214002a4f661d4035a2473e7e6036dbb835f02b2427bacf11ff83a0fd277d72ed1f58e097a39dd3aca1a8d40af6631ca8b666715893fa812ea2ba2e8e9fd68a498b0ce766ac94b22c701d4cddb75c8244479082ca4990e512959e431b5c1dddb29249572a228484ed2a9cc2225795c93032a0df8a5cd",
  },
  "oaep-SHA-384": {
    seed: "030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c",
    ct: "5b71d11c634f12445d28d559f9e047549ea98075c627a756ec6cc17ac1890e44de03e6ac8ffe2fdb2c1fbce8a176fd61bacc5482c471ae94946c5411123c33db450f730bf1c3dabefa95042cbf92ef00e6c40966a161def4ec52aef9fb85665d85a0ead8e04eff663dc70eecbb5e87ff4dba8e7db34e3ef1231d409c23a6de1bab28b9cf4fc588fd266df6087f9f2b6e9e3518a3bd694d58e3c978d36bdc5390a8fdee4cbfd9547a31f9a93f38a26527be0bd56bb8e2cb81a4236f1ff4d15f7b7cc4f4cb6c0de8fb1042ca5ebab3329c6c753187ab739ff1963d8454b08ecdd763199faf5de60be172f6877240656339c91485e867fb4c3d1c3b905fe18bdaa4",
  },
  "oaep-SHA-512": {
    seed: "030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bc",
    ct: "1e9d1bccbc26ebbff0932d761c319e9dc3bb4edf019ec76f3268cc30e5380f3275a1e28d7cd58ff22b296a49b157b64ee41a86ee1f1d9bb24f5d7965d36eef3c9fba127f36dd0fc8abe73d5a168856a28564a464f6138cff37566048e5d78f6fed1771e15aa2cce6c6ca758ec0f24f13a71778ad754561eccb63b3516cc7b6adddeb2e3198b6b3d70adc938c49051c4ca7cb5c128b7f13f24c23ce52fee83e1c1b8dfc24aeb03b7779c3938f6789a8d55cd8f655905cb4a9f8f5fb02a048f091383e1d6cb0f18ea132364d00422c192baba5cf092576415d45e3e4807c6b48440f99dcd9d18b56490863a8a84f14b6c7efef0a445d86d4aa6cc62ead0959cbf8",
  },
  v15: {
    ps: "02070c11161b20252a2f34393e43484d52575c61666b70757a7f84898e93989da2a7acb1b6bbc0c5cacfd4d9dee3e8edf2f7fc02070c11161b20252a2f34393e43484d52575c61666b70757a7f84898e93989da2a7acb1b6bbc0c5cacfd4d9dee3e8edf2f7fc02070c11161b20252a",
    ct: "a483ec80ac0a4da6e35055b886b344813c9c63c87ed9bed028c0235923b9c57201b591fee556ed5a3534956cb06968edb74f30feb784db6a4d875c55316980b52c363d30d07bfb0c22b084ad7635ebacd881a12ab499c808918328adab9c93cb33288bca15759143d2f7990a3f2384148d646c7a8fe27098724781918676df83",
  },
  "pss-SHA-1": {
    salt: "05101b26313c47525d68737e89949faab5c0cbd6",
    sig: "4e252d9536f31daf4e97327dc6df272cc8f1b44b493aabcf92deb10f1aafc6e9fc0a63dda81641b173cde984e3aa8f7c820c78b1287974b3ebb627dd096180a1d636a63a0b4c1d66b2f38d01e542afb51ec9633c78a9d1ab9f6b3cdbc896f6379f7813a734df96212775159dacf1015bd66422056b774d54e2bcaeb531a6a9b967f4867d9b163ab67e539fb1f47fd8d7b170499319d0a14e3277f57d7476b03c869ff564e86c247d58924e77fbf5a9ca15b801c94bf4928db745c97c7cd158ca9b0f7d1af03b393f88d033cf7244e00f854a00cc3a215d420d5085333766494deed3ff0b25859acd1d8edb340d3f949a29baf29588c0a8183163ed3ca9623780",
    saltlen: 20,
  },
  "pss-MD5": {
    salt: "05101b26313c47525d68737e89949faa",
    sig: "9387dcc9ce11a719095d754cb8424d78e18f5595c185f190d7ae68cc31d0ecaadd9d991665bbc6cbee755d693ca3176b8062131fc4b037a9e64136b16531f12f3ff526fd1a3be80c6e8e0f3cd3bd29d6925f87f50a23808dcbf1e7b620bdedf5a2f4923725fcae814856da773dc7cf0e87050b9223cc99d5da47ea6c7ddef1eeba503f9cb46b32e885fff76d21bfe75d3345e5d40042a01b4b2ac20984f3810200eb8dc012ba395ff877d3e5391999e3fe62e13860664c0118ae5443b873425759fa1fa51adc1a23a673370874e1d16c68aa4f6946f74079852cdc3d73e8891f7920b1d10eeb1fb39a5c93218298ef08a47b511702d2a3e4c8aba1563ff85d3c",
    saltlen: 16,
  },
  "pss-SHA-256": {
    salt: "05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a",
    sig: "47b2dca42a42c08bc115206cdd6312fef44a4e5bc02433baf399741d5439c7b3331914b8e59bec069e41b9dc6d9493b1cd9e1ff43fc9977725d9c628dbb22a651b2605763760603ca9f9b8284ce5966f2f9ee27f1b804e21833e7be0339c03a67810bf17818804cee659d765db9b625f452ba3bf1c1d92968566bc752e279728e66a7cbcb3ac3a077afd3d1769161b411cdd971ed5a7656d481a104479343ef7aa345fc66a67d05df7c16bed8e3f8bd41a465f80e49b5f6ef63f27978c7f74ad17535d6f5a1f5fbc9be93b92634588f01b46aac69dfd2436ece8b09a2a27cc2a27032c5a3261ff1b1ec6bbe336c0e59fd24ee5a55c6b16fe7a5d9edf2cf5edd6",
    saltlen: 32,
  },
  "pss-SHA-384": {
    salt: "05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a",
    sig: "8aacc8f0e62b5a19a36363fbd569e03d847b049ca2d1aebeff6bb271ca4812f049e2fef9ae95172683452dc49b469af2d831bfc2895a19fb765a6499dc17b18f3fdcc01603b4d4e001edbe4062e57d7e1bed2b16359149a1bd15f45d165f8e910fc3b700438a02d090b3d0a33e58c565b9ce08d5c91b30b1efeb8342291829374bd6ba93af1248ffd3624669b3924441393472c8de98fe7dedd58411e666074770e0af2f75f9af9c1303f2f56dad52acbcaf706cd949bcaae89a4afd8d41ae294a5602c10272a631f4afce7c2b7b29205bd0e8d2b3f4774673febb532a845c25f1f64d1c9cb81c3aeefd6b954f6e13b637ff1521c888e1ab119da78926d8e80a",
    saltlen: 32,
  },
  "pss-SHA-512": {
    salt: "05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a",
    sig: "c2d7bd739657722a916558f8f388a93cd83b4d65397c65ac8d4727a5d2866bc1a1c7e853a128eccb7130e3d4c3789fab366ea7fbe891db2762803c234113531afba8b5485c6bcb8013cb0479f7f84b124958501744036eae873539ebf93b7f409160ea5194337a429ae40886a112d5439d67a6288a408d7f516270a9c89c8392ba9e8ed176252d4ec02cc0d1dd057b6786b44f372639ea6d952d105fa7873528a9d61b994cd423fd318c255622562d1645a5db10aa68c15ba2afac979c762136bdb60ee365bf916b76f607e00da3e8b2aa353c580da3d2a9e09b68417031b4f779ec60f49ee46a8fb4b8d40cd19ee95e0cdebdb564ee163b94033c9e65535466",
    saltlen: 32,
  },
};

/** The pair of the stream SplitMix64(1), checked with openssl rsa -check and openssl rsa -pubout. */
const GOLDEN_1024 =
  "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLWttHj7gqflIQCdwxKW/tgxPB\nnHET3yDuy4LWwFZQysNNRJBu+WR6avZ4v8Jl2cjT1UiR5fikhnCXj8ncWrcAmQiE\nS7rUaakxgONrr/Qg3/y/tYWYxvZgBNS14iYsF1am+4wQ+N3mEPFdKO7nB/+sENce\nCnN+xjEevWjOKeArmwIDAQAB\n-----END PUBLIC KEY-----\n\n-----BEGIN RSA PRIVATE KEY-----\nMIICXQIBAAKBgQDLWttHj7gqflIQCdwxKW/tgxPBnHET3yDuy4LWwFZQysNNRJBu\n+WR6avZ4v8Jl2cjT1UiR5fikhnCXj8ncWrcAmQiES7rUaakxgONrr/Qg3/y/tYWY\nxvZgBNS14iYsF1am+4wQ+N3mEPFdKO7nB/+sENceCnN+xjEevWjOKeArmwIDAQAB\nAoGAXaugTjpZbtl5G4IvN0YLFLDILOrO+4RQOy7rOdim6dg8Vh87GKMwMWOL3NsX\nxKqo40rffrUb700uF+JX7XSrznveBkxAbLxAdKZw9XXPz5ErDPuEVnqppZiv3H8K\nUJz4MLeMsel25ysomLZYS360aPMFjBe3dMVy9CmZCG1FJOECQQD2WriT/iMcpsTU\nOYUxKUF9dHVcHp7uZM+tQe+0YF6ZHX3QEH7MqMBAIw4UZ34KcqNs2WdWJO55xt0U\n/l39Eal3AkEA01EjymeCWUdYBqz87WW1jWLS28hPxpbrzny3MfR7CaorpfVm58hT\nFRcjTCaETh0QcnrAzU9xBBB9DGdvnN4X/QJANEfEbAO+x9HMa41ZarlqoIkabtZA\nvC7As/AOQqVA7hWIIaOehSg6xGGsF0BvSyBQ9kSc3Xcw9L7zJAVnRNF+uQJBALEX\n3+HBi2jctHWrxbACO/uIZWPRZKHuWyJKPJD97Zr05O2JUrtOk+op4Ofxo5F/JAh8\nvVWSjQk19EZP7SbOrdUCQQDMYnRcs2R4IloGVrJeVZlk4UheQ9vYWronT1nl5hap\nnGj0Ui3l2ChG3zgZeZHNHzJvbtKiKDXvCdau/GykpoNz\n-----END RSA PRIVATE KEY-----\n";

interface NodeCrypto {
  constants: Record<string, number>;
  createHash(alg: string): { update(d: Uint8Array): { digest(): Uint8Array } };
  createPrivateKey(pem: string): {
    asymmetricKeyDetails?: { modulusLength?: number; publicExponent?: bigint };
  };
  createPublicKey(pem: string): { export(o: { type: string; format: string }): string };
  publicEncrypt(o: object, d: Uint8Array): Uint8Array;
  privateDecrypt(o: object, d: Uint8Array): Uint8Array;
  sign(alg: string | null, d: Uint8Array, o: object): Uint8Array;
  verify(alg: string | null, d: Uint8Array, o: object, sig: Uint8Array): boolean;
}
const nodeModule: string = "node:crypto";
const nodeCrypto = (await import(nodeModule)) as NodeCrypto;
const NC = nodeCrypto.constants;

const bundle = await loadBundleNode(["rsa"]);
const runtime = assembleRuntime(bundle);
type Result = Awaited<ReturnType<typeof runtime.call>>;

const text = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
const none = new Uint8Array(0);
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const message = (r: Result) => (r.ok ? "" : r.error.message);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const topBytes = (r: Result) => {
  expect(code(r), message(r)).toBe("ok");
  return top(r) as Uint8Array;
};
const topStr = (r: Result) => {
  expect(code(r), message(r)).toBe("ok");
  const v = top(r);
  return typeof v === "string" ? v : new TextDecoder().decode(v as Uint8Array);
};

const DIGESTS = ["SHA-1", "MD5", "SHA-256", "SHA-384", "SHA-512"] as const;
const nodeHash = (d: string) => d.toLowerCase().replace("-", "");

interface SignOpts {
  password?: string;
  digest?: string;
  scheme?: string;
  salt?: number;
}
const sign = (data: Uint8Array, key: string, o: SignOpts = {}) =>
  runtime.call("rsa:sign", [
    bytes(data),
    str(key),
    str(o.password ?? ""),
    str(o.digest ?? "SHA-1"),
    str(o.scheme ?? "RSASSA-PKCS1-V1_5"),
    int(o.salt ?? -1),
  ]);
const verify = (sig: Uint8Array, key: string, msg: Uint8Array, o: SignOpts = {}) =>
  runtime.call("rsa:verify", [
    bytes(sig),
    str(key),
    bytes(msg),
    str(o.digest ?? "SHA-1"),
    str(o.scheme ?? "RSASSA-PKCS1-V1_5"),
    int(o.salt ?? -1),
  ]);
const encrypt = (data: Uint8Array, key: string, scheme = "RSA-OAEP", digest = "SHA-1") =>
  runtime.call("rsa:encrypt", [bytes(data), str(key), str(scheme), str(digest)]);
const decrypt = (data: Uint8Array, key: string, scheme = "RSA-OAEP", digest = "SHA-1", pw = "") =>
  runtime.call("rsa:decrypt", [bytes(data), str(key), str(pw), str(scheme), str(digest)]);
const publicKey = (key: string, format = "PEM", pw = "") =>
  runtime.call("rsa:public-key", [str(key), str(format), str(pw)]);
const generate = (size = "2048", format = "PEM") =>
  runtime.call("rsa:generate-key-pair", [bytes(none), str(size), str(format)]);

/** SplitMix64: a deterministic stream of bytes to stand in for the host's random generator. */
function splitmix(seed: bigint): (n: number) => Uint8Array {
  let s = seed;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    s = (s + 0x9e3779b97f4a7c15n) & mask;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return z ^ (z >> 31n);
  };
  return (n) => {
    const out = new Uint8Array(n);
    for (let at = 0; at < n; at += 8) {
      let v = next();
      for (let i = 0; i < 8 && at + i < n; i++) {
        out[at + i] = Number(v & 255n);
        v >>= 8n;
      }
    }
    return out;
  };
}

/** Replaces the host's random generator by a deterministic stream. */
function pinStream(seed: bigint): void {
  const gen = splitmix(seed);
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => {
      a.set(gen(a.length));
      return a;
    },
  });
}

/** Replaces it by a queue of exact reads: each call to getRandomValues takes the next array. */
function pinReads(reads: Uint8Array[]): { calls: () => number } {
  let i = 0;
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => {
      const r = reads[i++];
      if (r === undefined || r.length !== a.length)
        throw new Error(`unexpected read #${i} of ${a.length} bytes`);
      a.set(r);
      return a;
    },
  });
  return { calls: () => i };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const MSG = text("The quick brown fox jumps over the lazy dog");
const PT = text("attack at dawn");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 of bytes (with padding) and the inverse (white space ignored), written here: the package has no Node types. */
function toB64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += i + 1 < b.length ? B64.charAt((n >> 6) & 63) : "=";
    out += i + 2 < b.length ? B64.charAt(n & 63) : "=";
  }
  return out;
}
function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const c of clean) {
    acc = (acc << 6) | B64.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}
const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
/** The offset and length of the content of each INTEGER of a PKCS#1 RSAPrivateKey (version, n, e, d, p, q, dp, dq, qi). */
function derInts(der: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  const len = () => {
    const b = der[at++] as number;
    if (b < 128) return b;
    let n = 0;
    for (let i = 0; i < (b & 127); i++) n = n * 256 + (der[at++] as number);
    return n;
  };
  expect(der[at++]).toBe(0x30);
  len();
  for (let i = 0; i < 9; i++) {
    expect(der[at++]).toBe(2);
    const l = len();
    out.push([at, l]);
    at += l;
  }
  expect(at).toBe(der.length);
  return out;
}

const pubOf = async (key: string) => latin(topBytes(await publicKey(key)));

describe("key generation", () => {
  test("a pinned source gives a pinned 1024-bit pair that OpenSSL reads and uses", async () => {
    pinStream(1n);
    const r = await generate("1024");
    expect(r.ok && r.effects).toEqual(["+random"]);
    const pem = topStr(r);
    const [pub, priv] = pem.split("\n\n");
    expect(pem.endsWith("-----END RSA PRIVATE KEY-----\n")).toBe(true);
    expect(pub).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----$/);
    expect(pem).toBe(GOLDEN_1024);
    const key = nodeCrypto.createPrivateKey(priv as string);
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(1024);
    expect(key.asymmetricKeyDetails?.publicExponent).toBe(65537n);
    // the public half is the one of the private half
    expect(await pubOf(priv as string)).toBe(`${pub}\n`);
    // signed here, verified by OpenSSL; signed by OpenSSL, verified here
    const sig = topBytes(await sign(MSG, priv as string, { digest: "SHA-256" }));
    expect(nodeCrypto.verify("sha256", MSG, { key: pub as string }, sig)).toBe(true);
    const sig2 = nodeCrypto.sign("sha256", MSG, { key: priv as string });
    expect(topStr(await verify(sig2, pub as string, MSG, { digest: "SHA-256" }))).toBe(
      "Verified OK",
    );
  });

  test("the JWK format writes the public key, then the private key, one line each", async () => {
    pinStream(1n);
    const jwk = topStr(await generate("1024", "JWK"));
    const lines = jwk.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    const pub = JSON.parse(lines[0] as string) as Record<string, string>;
    const priv = JSON.parse(lines[1] as string) as Record<string, string>;
    expect(Object.keys(pub)).toEqual(["kty", "n", "e"]);
    expect(Object.keys(priv)).toEqual(["kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"]);
    expect(pub.e).toBe("AQAB");
    expect(priv.n).toBe(pub.n);
    // the same stream gives the same key as the PEM
    pinStream(1n);
    const pem = topStr(await generate("1024", "PEM"));
    const nodeJwk = (
      nodeCrypto.createPublicKey(pem.split("\n\n")[0] as string) as unknown as {
        export(o: object): Record<string, string>;
      }
    ).export({ format: "jwk" });
    expect(pub.n).toBe(nodeJwk.n);
    expect(latin(topBytes(await publicKey(pem.split("\n\n")[1] as string, "JWK")))).toBe(lines[0]);
  });

  test("the primes are what the construction promises (1024-bit key, 512-bit primes)", async () => {
    pinStream(2n);
    const pem = topStr(await generate("1024"));
    const priv = pem.split("\n\n")[1] as string;
    const der = fromB64(priv.split("\n").slice(1, -2).join(""));
    const ints = derInts(der).map(([at, l]) => BigInt(`0x${hex(der.subarray(at, at + l))}`));
    const [, n, e, d, p, q, dp, dq, qi] = ints as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    expect(n.toString(2)).toHaveLength(1024);
    expect(e).toBe(65537n);
    expect(p * q).toBe(n);
    expect(p > q).toBe(true);
    expect(p >> 510n).toBe(3n);
    expect(q >> 510n).toBe(3n);
    expect(p - q > 1n << 412n).toBe(true);
    const lcm = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n);
    expect((d * e) % lcm).toBe(1n);
    expect(dp).toBe(d % (p - 1n));
    expect(dq).toBe(d % (q - 1n));
    expect((qi * q) % p).toBe(1n);
  });

  test("a 2048-bit pair from the real source works with OpenSSL, and two calls differ", async () => {
    const a = topStr(await generate("2048"));
    const b = topStr(await generate("2048"));
    expect(a).not.toBe(b);
    const priv = a.split("\n\n")[1] as string;
    expect(nodeCrypto.createPrivateKey(priv).asymmetricKeyDetails?.modulusLength).toBe(2048);
    const ct = topBytes(await encrypt(PT, a.split("\n\n")[0] as string));
    expect(ct).toHaveLength(256);
    expect(topBytes(await decrypt(ct, priv))).toEqual(PT);
  });

  test(
    "a pinned 4096-bit pair: it works with OpenSSL, and the cost is recorded",
    { timeout: 120_000 },
    async () => {
      pinStream(4096n);
      const r = await generate("4096");
      const pem = topStr(r);
      const [pub, priv] = pem.split("\n\n") as [string, string];
      expect(nodeCrypto.createPrivateKey(priv).asymmetricKeyDetails?.modulusLength).toBe(4096);
      // measured: 3,942 VM steps and about 1.3 s for this stream (README, "RSA (WP 5.50)")
      if (r.ok) expect(r.steps).toBeLessThan(10_000);
      const sig = nodeCrypto.sign("sha256", MSG, { key: priv });
      expect(topStr(await verify(sig, pub, MSG, { digest: "SHA-256" }))).toBe("Verified OK");
    },
  );

  test("the DER format is the PKCS#1 private key alone, as bytes (CyberChef's DER format)", async () => {
    pinStream(1n);
    const der = topBytes(await generate("1024", "DER"));
    const priv = GOLDEN_1024.split("\n\n")[1] as string;
    const body = priv.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    expect(hex(der)).toBe(hex(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))));
    expect(der[0]).toBe(0x30);
  });

  test("a source that never gives a prime stops with an error, not a hang", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0) });
    const r = await generate("1024");
    expect(code(r)).toBe("E_USER");
    expect(message(r)).toMatch(/no prime found/);
  });

  test("a host with no random generator is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(code(await generate("1024"))).toBe("E_PRIMITIVE");
    expect(code(await encrypt(PT, PUB2048))).toBe("E_PRIMITIVE");
  });
});

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

describe("signatures", () => {
  test("RSASSA-PKCS1-v1_5 signs what OpenSSL signs, for every digest, and verifies both ways", async () => {
    const pub = await pubOf(K2048);
    for (const d of DIGESTS) {
      const mine = topBytes(await sign(MSG, K2048, { digest: d }));
      const theirs = nodeCrypto.sign(nodeHash(d), MSG, { key: K2048 });
      expect(hex(mine)).toBe(hex(theirs));
      expect(topStr(await verify(theirs, pub, MSG, { digest: d }))).toBe("Verified OK");
    }
  });

  test("RSASSA-PSS signatures verify with OpenSSL, for every digest and salt length, and with the verifier here", async () => {
    const pub = await pubOf(K2048);
    for (const d of DIGESTS) {
      for (const salt of [-1, 0, 7, 20]) {
        const sig = topBytes(await sign(MSG, K2048, { digest: d, scheme: "RSASSA-PSS", salt }));
        const saltLength =
          salt === -1
            ? { SHA1: 20, MD5: 16, SHA256: 32, SHA384: 48, SHA512: 64 }[
                nodeHash(d).toUpperCase() as "SHA1"
              ]
            : salt;
        expect(
          nodeCrypto.verify(
            nodeHash(d),
            MSG,
            { key: pub, padding: NC.RSA_PKCS1_PSS_PADDING, saltLength },
            sig,
          ),
        ).toBe(true);
        expect(topStr(await verify(sig, pub, MSG, { digest: d, scheme: "RSASSA-PSS", salt }))).toBe(
          "Verified OK",
        );
        expect(topStr(await verify(sig, pub, MSG, { digest: d, scheme: "RSASSA-PSS" }))).toBe(
          "Verified OK",
        );
        expect(
          topStr(await verify(sig, pub, MSG, { digest: d, scheme: "RSASSA-PSS", salt: salt + 1 })),
        ).toBe("Verification Failure");
      }
    }
  });

  test("RSASSA-PSS signatures made by OpenSSL verify here", async () => {
    const pub = await pubOf(K2048);
    for (const d of DIGESTS) {
      const hl = nodeCrypto.createHash(nodeHash(d)).update(none).digest().length;
      const sig = nodeCrypto.sign(nodeHash(d), MSG, {
        key: K2048,
        padding: NC.RSA_PKCS1_PSS_PADDING,
        saltLength: hl,
      });
      expect(
        topStr(await verify(sig, pub, MSG, { digest: d, scheme: "RSASSA-PSS", salt: hl })),
      ).toBe("Verified OK");
    }
  });

  test("PSS with a pinned salt is the signature of a second implementation of RFC 8017", async () => {
    for (const d of DIGESTS) {
      const v = PINNED[`pss-${d}`] as { salt: string; sig: string; saltlen: number };
      const reads = pinReads([unhex(v.salt)]);
      const sig = topBytes(
        await sign(PT, K2048, { digest: d, scheme: "RSASSA-PSS", salt: v.saltlen }),
      );
      expect(hex(sig)).toBe(v.sig);
      expect(reads.calls()).toBe(1);
    }
  });

  test("PSS needs room in the key: too large a salt or digest is E_RANGE, before any random byte is read", async () => {
    pinReads([]);
    // 1024-bit key, SHA-512: emLen 128, 64 + 64 + 2 is 130
    expect(code(await sign(MSG, K1024, { digest: "SHA-512", scheme: "RSASSA-PSS" }))).toBe(
      "E_RANGE",
    );
    expect(
      code(await sign(MSG, K1024, { digest: "SHA-256", scheme: "RSASSA-PSS", salt: 95 })),
    ).toBe("E_RANGE");
    expect(
      code(await sign(MSG, K1024, { digest: "SHA-256", scheme: "RSASSA-PSS", salt: -2 })),
    ).toBe("E_RANGE");
  });

  test("verify: the signature of another key, of a longer value, or all ones, is a failed verification", async () => {
    const pub = await pubOf(K1024);
    const sig = topBytes(await sign(MSG, K1024, { digest: "SHA-256" }));
    expect(topStr(await verify(sig, await pubOf(K2048), MSG, { digest: "SHA-256" }))).toBe(
      "Verification Failure",
    );
    expect(topStr(await verify(new Uint8Array(129), pub, MSG))).toBe("Verification Failure");
    expect(topStr(await verify(new Uint8Array(128).fill(255), pub, MSG))).toBe(
      "Verification Failure",
    );
    expect(topStr(await verify(new Uint8Array(128), pub, MSG))).toBe("Verification Failure");
    for (const scheme of ["RSASSA-PKCS1-V1_5", "RSASSA-PSS"])
      for (let cut = 0; cut < sig.length; cut += 17)
        expect(
          topStr(await verify(sig.slice(0, cut), pub, MSG, { digest: "SHA-256", scheme })),
        ).toBe("Verification Failure");
  });

  test("verify accepts the first public key block of a longer text, and refuses text without one", async () => {
    const sig = topBytes(await sign(MSG, K1024, { digest: "SHA-256" }));
    const both = topStr(await generate("1024")); // a different pair: public block first
    const pub = await pubOf(K1024);
    expect(
      topStr(await verify(sig, `# comment\n${pub}\n${K1024}`, MSG, { digest: "SHA-256" })),
    ).toBe("Verified OK");
    expect(topStr(await verify(sig, `${both}`, MSG, { digest: "SHA-256" }))).toBe(
      "Verification Failure",
    );
    expect(code(await verify(sig, K1024, MSG))).toBe("E_RANGE");
    expect(code(await verify(sig, "", MSG))).toBe("E_RANGE");
  });

  test("a 64 KiB message: the cost is the digest, a few thousand VM steps", async () => {
    const big = new Uint8Array(65_536).map((_, i) => (i * 31 + 7) & 255);
    const r = await sign(big, K2048, { digest: "SHA-256" });
    expect(hex(topBytes(r))).toBe(hex(nodeCrypto.sign("sha256", big, { key: K2048 })));
    if (r.ok) {
      expect(r.steps).toBeLessThan(50_000);
    }
  });

  test("the cost of one private operation: 1024, 2048 and 4096-bit keys", async () => {
    // measured: 5,430 / 9,404 / 17,340 VM steps and 7 / 13 / 61 ms (README, "RSA (WP 5.50)")
    for (const [, key, steps] of [
      ["1024", K1024, 50_000],
      ["2048", K2048, 50_000],
      ["4096", K4096, 50_000],
    ] as const) {
      const r = await sign(MSG, key, { digest: "SHA-256" });
      expect(code(r)).toBe("ok");
      if (r.ok) {
        expect(r.steps).toBeLessThan(steps);
        expect(r.elapsedMs).toBeLessThan(2_000);
      }
    }
  });
});

describe("encryption", () => {
  test("RSA-OAEP: every digest, our ciphertext opens with OpenSSL and OpenSSL's opens here", async () => {
    const pub = await pubOf(K2048);
    for (const d of DIGESTS) {
      const ct = topBytes(await encrypt(PT, pub, "RSA-OAEP", d));
      expect(ct).toHaveLength(256);
      expect(
        hex(
          nodeCrypto.privateDecrypt(
            { key: K2048, padding: NC.RSA_PKCS1_OAEP_PADDING, oaepHash: nodeHash(d) },
            ct,
          ),
        ),
      ).toBe(hex(PT));
      const theirs = nodeCrypto.publicEncrypt(
        { key: pub, padding: NC.RSA_PKCS1_OAEP_PADDING, oaepHash: nodeHash(d) },
        PT,
      );
      expect(topBytes(await decrypt(theirs, K2048, "RSA-OAEP", d))).toEqual(PT);
    }
  });

  test("RSA-OAEP: the longest message, the empty message and binary data", async () => {
    const pub = await pubOf(K2048);
    const longest = new Uint8Array(256 - 2 * 20 - 2).map((_, i) => i);
    expect(topBytes(await decrypt(topBytes(await encrypt(longest, pub)), K2048))).toEqual(longest);
    expect(topBytes(await decrypt(topBytes(await encrypt(none, pub)), K2048))).toEqual(none);
    expect(code(await encrypt(new Uint8Array(longest.length + 1), pub))).toBe("E_RANGE");
    const all = Uint8Array.from({ length: 100 }, (_, i) => (i * 7) & 255);
    expect(
      topBytes(
        await decrypt(
          topBytes(await encrypt(all, pub, "RSA-OAEP", "SHA-256")),
          K2048,
          "RSA-OAEP",
          "SHA-256",
        ),
      ),
    ).toEqual(all);
  });

  test("RSA-OAEP with a pinned seed is the ciphertext of a second implementation of RFC 8017", async () => {
    for (const d of DIGESTS) {
      const v = PINNED[`oaep-${d}`] as { seed: string; ct: string };
      const reads = pinReads([unhex(v.seed)]);
      const ct = topBytes(await encrypt(PT, PUB2048, "RSA-OAEP", d));
      expect(hex(ct)).toBe(v.ct);
      expect(reads.calls()).toBe(1);
    }
  });

  test("RSAES-PKCS1-V1_5 with pinned padding is the ciphertext of a second implementation, and OpenSSL reads the structure", async () => {
    const v = PINNED.v15 as { ps: string; ct: string };
    const pub1024 = await pubOf(K1024);
    const reads = pinReads([unhex(v.ps)]);
    const ct = topBytes(await encrypt(PT, pub1024, "RSAES-PKCS1-V1_5"));
    expect(hex(ct)).toBe(v.ct);
    expect(reads.calls()).toBe(1);
    // the block, opened without padding by OpenSSL: 00 02 PS 00 M
    const em = nodeCrypto.privateDecrypt({ key: K1024, padding: NC.RSA_NO_PADDING }, ct);
    expect(hex(em)).toBe(`0002${v.ps}00${hex(PT)}`);
  });

  test("RSAES-PKCS1-V1_5: zero bytes of the source are not used as padding", async () => {
    // the first read has zeros in it: they are dropped and the missing bytes are read again
    const k = 128;
    const n = k - 3 - PT.length;
    const first = new Uint8Array(n).fill(9);
    first[3] = 0;
    first[10] = 0;
    const second = new Uint8Array(2).fill(7);
    pinReads([first, second]);
    const ct = topBytes(await encrypt(PT, await pubOf(K1024), "RSAES-PKCS1-V1_5"));
    const em = nodeCrypto.privateDecrypt({ key: K1024, padding: NC.RSA_NO_PADDING }, ct);
    const ps = em.slice(2, em.length - PT.length - 1);
    expect(ps).toHaveLength(n);
    expect(ps.every((b) => b !== 0)).toBe(true);
    expect(Array.from(ps.slice(-2))).toEqual([7, 7]);
  });

  test("RSAES-PKCS1-V1_5 round trips, and OpenSSL's ciphertext opens here; the limit is key bytes - 11", async () => {
    const pub = await pubOf(K2048);
    const ct = topBytes(await encrypt(PT, pub, "RSAES-PKCS1-V1_5"));
    expect(topBytes(await decrypt(ct, K2048, "RSAES-PKCS1-V1_5"))).toEqual(PT);
    const theirs = nodeCrypto.publicEncrypt({ key: pub, padding: NC.RSA_PKCS1_PADDING }, PT);
    expect(topBytes(await decrypt(theirs, K2048, "RSAES-PKCS1-V1_5"))).toEqual(PT);
    const longest = new Uint8Array(245).fill(65);
    expect(
      topBytes(
        await decrypt(
          topBytes(await encrypt(longest, pub, "RSAES-PKCS1-V1_5")),
          K2048,
          "RSAES-PKCS1-V1_5",
        ),
      ),
    ).toEqual(longest);
    expect(code(await encrypt(new Uint8Array(246), pub, "RSAES-PKCS1-V1_5"))).toBe("E_RANGE");
    expect(
      topBytes(
        await decrypt(
          topBytes(await encrypt(none, pub, "RSAES-PKCS1-V1_5")),
          K2048,
          "RSAES-PKCS1-V1_5",
        ),
      ),
    ).toEqual(none);
  });

  test("RAW is textbook RSA: deterministic, the length of the modulus, and the inverse", async () => {
    const pub = await pubOf(K2048);
    const ct = topBytes(await encrypt(PT, pub, "RAW"));
    expect(ct).toHaveLength(256);
    expect(topBytes(await encrypt(PT, pub, "RAW"))).toEqual(ct);
    expect(hex(ct)).toBe(
      hex(
        nodeCrypto.publicEncrypt(
          { key: pub, padding: NC.RSA_NO_PADDING },
          Uint8Array.of(...new Uint8Array(256 - PT.length), ...PT),
        ),
      ),
    );
    const back = topBytes(await decrypt(ct, K2048, "RAW"));
    expect(back).toHaveLength(256);
    expect(hex(back)).toBe("00".repeat(256 - PT.length) + hex(PT));
  });

  test("the schemes use no random bytes but their own: RAW reads none, OAEP reads the digest length", async () => {
    const pub = await pubOf(K2048);
    pinReads([]);
    expect(code(await encrypt(PT, pub, "RAW"))).toBe("ok");
    vi.unstubAllGlobals();
    for (const [d, n] of [
      ["SHA-1", 20],
      ["MD5", 16],
      ["SHA-256", 32],
      ["SHA-384", 48],
      ["SHA-512", 64],
    ] as const) {
      const reads = pinReads([new Uint8Array(n).fill(3)]);
      expect(code(await encrypt(PT, pub, "RSA-OAEP", d))).toBe("ok");
      expect(reads.calls()).toBe(1);
      vi.unstubAllGlobals();
    }
  });
});

/** An OAEP block (RFC 8017 7.1.1) built here with node:crypto digests, with faults on request. */
function oaepBlock(
  msg: Uint8Array,
  k: number,
  d: string,
  seed: Uint8Array,
  fault: "none" | "hash" | "one" | "lead" | "zeros" = "none",
): Uint8Array {
  const h = (x: Uint8Array) => nodeCrypto.createHash(nodeHash(d)).update(x).digest();
  const hl = h(none).length;
  const mgf = (s: Uint8Array, n: number) => {
    const parts: number[] = [];
    for (let c = 0; parts.length < n; c++)
      parts.push(...h(Uint8Array.of(...s, 0, 0, c >> 8, c & 255)));
    return parts.slice(0, n);
  };
  const lhash = Array.from(h(none));
  if (fault === "hash") lhash[0] = (lhash[0] as number) ^ 1;
  const ps = new Array<number>(k - msg.length - 2 * hl - 2).fill(0);
  // zeros: PS runs to the end, there is no 01 and no message
  const db =
    fault === "zeros"
      ? Uint8Array.of(...lhash, ...new Array<number>(k - 2 * hl - 1).fill(0))
      : Uint8Array.of(...lhash, ...ps, fault === "one" ? 2 : 1, ...msg);
  const mdb = db.map((b, i) => b ^ (mgf(seed, db.length)[i] as number));
  const ms = seed.map((b, i) => b ^ (mgf(mdb, hl)[i] as number));
  return Uint8Array.of(fault === "lead" ? 1 : 0, ...ms, ...mdb);
}

describe("decryption errors", () => {
  const pub2048 = PUB2048;

  test("every fault in a block gives the same error, whatever the scheme and the digest", async () => {
    const seen = new Set<string>();
    let n = 0;
    const note = (r: Result) => {
      n++;
      expect(code(r), `case ${n}`).toBe("E_COERCE");
      seen.add(message(r));
    };
    const rawEnc = (em: Uint8Array) =>
      nodeCrypto.publicEncrypt({ key: pub2048, padding: NC.RSA_NO_PADDING }, em);
    for (const d of DIGESTS) {
      const seed = new Uint8Array(
        nodeCrypto.createHash(nodeHash(d)).update(none).digest().length,
      ).fill(5);
      // a good block opens
      const good = oaepBlock(PT, 256, d, seed);
      expect(topBytes(await decrypt(rawEnc(good), K2048, "RSA-OAEP", d))).toEqual(PT);
      for (const fault of ["hash", "one", "lead", "zeros"] as const)
        note(await decrypt(rawEnc(oaepBlock(PT, 256, d, seed, fault)), K2048, "RSA-OAEP", d));
      // a block for another digest
      note(await decrypt(rawEnc(good), K2048, "RSA-OAEP", d === "SHA-1" ? "SHA-256" : "SHA-1"));
    }
    // PKCS#1 v1.5 blocks of 256 bytes: good, then faults (the message fills what the padding leaves)
    const v15 = (bt: number, ps: number[], sep = true) => {
      const fill = 256 - 2 - ps.length - (sep ? 1 : 0);
      return Uint8Array.of(0, bt, ...ps, ...(sep ? [0] : []), ...new Array<number>(fill).fill(65));
    };
    const ok = Uint8Array.of(0, 2, ...new Array<number>(256 - 3 - PT.length).fill(9), 0, ...PT);
    expect(topBytes(await decrypt(rawEnc(ok), K2048, "RSAES-PKCS1-V1_5"))).toEqual(PT);
    note(
      await decrypt(rawEnc(v15(1, new Array<number>(100).fill(255))), K2048, "RSAES-PKCS1-V1_5"),
    );
    note(await decrypt(rawEnc(v15(2, new Array<number>(7).fill(9))), K2048, "RSAES-PKCS1-V1_5"));
    note(
      await decrypt(
        rawEnc(v15(2, new Array<number>(254).fill(9), false)),
        K2048,
        "RSAES-PKCS1-V1_5",
      ),
    );
    note(
      await decrypt(
        rawEnc(
          Uint8Array.of(
            1,
            2,
            ...new Array<number>(100).fill(9),
            0,
            ...new Array<number>(153).fill(65),
          ),
        ),
        K2048,
        "RSAES-PKCS1-V1_5",
      ),
    );
    // lengths and ranges
    note(await decrypt(none, K2048));
    note(await decrypt(new Uint8Array(255).fill(1), K2048));
    note(await decrypt(new Uint8Array(257).fill(1), K2048));
    note(await decrypt(new Uint8Array(256).fill(255), K2048));
    note(await decrypt(new Uint8Array(256), K2048));
    note(await decrypt(new Uint8Array(256).fill(255), K2048, "RAW"));
    note(await decrypt(new Uint8Array(10), K2048, "RAW"));
    // a ciphertext of the wrong key
    note(await decrypt(topBytes(await encrypt(PT, await pubOf(K1024))), K2048));
    expect(Array.from(seen)).toHaveLength(1);
    expect(Array.from(seen)[0]).toMatch(/decryption error$/);
  });

  test("a bit flipped anywhere in a ciphertext is the same error", async () => {
    const ct = topBytes(await encrypt(PT, pub2048));
    const msgs = new Set<string>();
    for (let i = 0; i < 256; i += 11) {
      const bad = ct.slice();
      bad[i] = (bad[i] as number) ^ (1 << (i % 8));
      const r = await decrypt(bad, K2048);
      expect(code(r)).toBe("E_COERCE");
      msgs.add(message(r));
    }
    expect(msgs.size).toBe(1);
  });
});

describe("keys", () => {
  const der = (pem: string) =>
    fromB64(
      pem
        .split("\n")
        .filter((l) => !l.startsWith("-----"))
        .join(""),
    );
  const pemOf = (label: string, d: Uint8Array) =>
    `-----BEGIN ${label}-----\n${toB64(d).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;

  test("the private key forms: PKCS#1, PKCS#8, and the public key forms, give the same public key", async () => {
    const pub = await pubOf(K1024);
    const p8 = nodeCrypto.createPrivateKey(K1024) as unknown as { export(o: object): string };
    const pkcs8 = p8.export({ type: "pkcs8", format: "pem" });
    expect(await pubOf(pkcs8)).toBe(pub);
    const rsaPub = (
      nodeCrypto.createPublicKey(K1024) as unknown as { export(o: object): string }
    ).export({ type: "pkcs1", format: "pem" });
    expect(rsaPub).toMatch(/BEGIN RSA PUBLIC KEY/);
    const sig = topBytes(await sign(MSG, pkcs8, { digest: "SHA-256" }));
    expect(topStr(await verify(sig, rsaPub, MSG, { digest: "SHA-256" }))).toBe("Verified OK");
    expect(topStr(await verify(sig, pub, MSG, { digest: "SHA-256" }))).toBe("Verified OK");
    expect(Array.from(sig)).toEqual(
      Array.from(topBytes(await sign(MSG, K1024, { digest: "SHA-256" }))),
    );
    // CRLF line ends and a leading comment are read
    const crlf = `# my key\r\n${K1024.replace(/\n/g, "\r\n")}`;
    expect(await pubOf(crlf)).toBe(pub);
  });

  test("the public key as DER and as JWK", async () => {
    const pub = nodeCrypto.createPublicKey(K1024) as unknown as { export(o: object): Uint8Array };
    expect(hex(topBytes(await publicKey(K1024, "DER")))).toBe(
      hex(pub.export({ type: "spki", format: "der" })),
    );
    const jwk = JSON.parse(latin(topBytes(await publicKey(K1024, "JWK")))) as Record<
      string,
      string
    >;
    expect(jwk.kty).toBe("RSA");
    const nodeJwk = (
      nodeCrypto.createPublicKey(K1024) as unknown as { export(o: object): Record<string, string> }
    ).export({ format: "jwk" });
    expect(jwk).toEqual({ kty: "RSA", n: nodeJwk.n, e: nodeJwk.e });
  });

  test("an EC key is E_RANGE for sign, pointing to the ecdsa words, and public-key reads it", async () => {
    const ec =
      "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIEAwJhVSn/wDvO2NDkcSr8S7GM15jEJpj5SIg0pN1lcAoAoGCCqGSM49\nAwEHoUQDQgAE4iZ7JhnbpuUcMAeQf9LvC+UlHIPyLwVyeg2z4yKBxVfTBa0j1wk4\nwyoyJwHA/bZ/aDNEB6pkpNfQqYkFA1ghuw==\n-----END EC PRIVATE KEY-----\n";
    const r = await sign(none, ec);
    expect(code(r)).toBe("E_RANGE");
    expect(message(r)).toMatch(/use the ecdsa words for elliptic curve keys/);
    const pub = await publicKey(ec);
    expect(code(pub)).toBe("ok");
    expect(new TextDecoder("latin1").decode(topBytes(pub))).toMatch(
      /^-----BEGIN PUBLIC KEY-----\n/,
    );
  });

  test("a key cut at every byte, in every form, is E_COERCE and never a key or a crash", async () => {
    const forms: [string, string, Uint8Array][] = [
      ["RSA PRIVATE KEY", "private", der(K1024)],
      [
        "PRIVATE KEY",
        "private",
        (nodeCrypto.createPrivateKey(K1024) as unknown as { export(o: object): Uint8Array }).export(
          { type: "pkcs8", format: "der" },
        ),
      ],
      [
        "PUBLIC KEY",
        "public",
        (nodeCrypto.createPublicKey(K1024) as unknown as { export(o: object): Uint8Array }).export({
          type: "spki",
          format: "der",
        }),
      ],
      [
        "RSA PUBLIC KEY",
        "public",
        (nodeCrypto.createPublicKey(K1024) as unknown as { export(o: object): Uint8Array }).export({
          type: "pkcs1",
          format: "der",
        }),
      ],
    ];
    const sig = topBytes(await sign(MSG, K1024, { digest: "SHA-256" }));
    for (const [label, kind, d] of forms) {
      for (let cut = 0; cut < d.length; cut++) {
        const pem = pemOf(label, d.slice(0, cut));
        const r =
          kind === "private"
            ? await publicKey(pem)
            : await verify(sig, pem, MSG, { digest: "SHA-256" });
        expect(code(r), `${label} cut at ${cut}`).toBe("E_COERCE");
      }
      const whole = pemOf(label, d);
      expect(
        code(
          kind === "private"
            ? await publicKey(whole)
            : await verify(sig, whole, MSG, { digest: "SHA-256" }),
        ),
      ).toBe("ok");
    }
  });

  test("mutated keys give a key or E_COERCE and E_RANGE only, and a mutated private key never signs wrongly", async () => {
    const d = der(K1024);
    const rnd = splitmix(77n);
    const pub = await pubOf(K1024);
    let signed = 0;
    for (let i = 0; i < 300; i++) {
      const m = Uint8Array.from(d);
      const flips = 1 + ((rnd(1)[0] as number) % 3);
      for (let f = 0; f < flips; f++) {
        const at = ((rnd(2)[0] as number) * 256 + (rnd(2)[1] as number)) % m.length;
        m[at] = (m[at] as number) ^ (1 << ((rnd(1)[0] as number) % 8));
      }
      const r = await sign(MSG, pemOf("RSA PRIVATE KEY", m), { digest: "SHA-256" });
      expect(["ok", "E_COERCE", "E_RANGE"]).toContain(code(r));
      if (r.ok) {
        signed++;
        // whatever key was read, a signature that comes out is correct for the real key
        expect(topStr(await verify(top(r) as Uint8Array, pub, MSG, { digest: "SHA-256" }))).toBe(
          "Verified OK",
        );
      }
    }
    // flips in unused fields (d, the version bytes of lengths) can survive; they are rare but allowed
    expect(signed).toBeLessThan(150);
  });

  test("hostile lengths allocate nothing and are E_COERCE", async () => {
    const hostile = [
      Uint8Array.of(0x30, 0x84, 0xff, 0xff, 0xff, 0xff),
      Uint8Array.of(0x30, 0x82, 0xff, 0xff, 0x02, 0x01, 0x00),
      Uint8Array.of(0x30, 0x80, 0x02, 0x01, 0x00, 0x00, 0x00),
      Uint8Array.of(0x30, 0x03, 0x02, 0x84, 0xff, 0xff, 0xff, 0xff, 0x01),
      new Uint8Array(0),
      Uint8Array.of(0x30, 0x00),
      Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00),
    ];
    for (const label of ["RSA PRIVATE KEY", "PRIVATE KEY", "PUBLIC KEY", "RSA PUBLIC KEY"])
      for (const h of hostile) {
        const pem = pemOf(label, h);
        const r = label.includes("PRIVATE") ? await publicKey(pem) : await verify(none, pem, MSG);
        expect(code(r), `${label} ${hex(h)}`).toBe("E_COERCE");
      }
  });

  test("a damaged key says what is wrong", async () => {
    const d = Uint8Array.from(der(K1024));
    const ints = derInts(d);
    const flipLast = (i: number) => {
      const m = d.slice();
      const [at, len] = ints[i] as [number, number];
      m[at + len - 1] = (m[at + len - 1] as number) ^ 4;
      return m;
    };
    // p changed: p times q is not n
    const rp = await publicKey(pemOf("RSA PRIVATE KEY", flipLast(4)));
    expect(code(rp)).toBe("E_COERCE");
    expect(message(rp)).toMatch(/p times q is not the modulus/);
    // dp changed: the check by the public operation catches it when signing
    const rd = await sign(MSG, pemOf("RSA PRIVATE KEY", flipLast(6)), { digest: "SHA-256" });
    expect(code(rd)).toBe("E_COERCE");
    expect(message(rd)).toMatch(/did not invert/);
    // qi changed
    expect(
      code(await sign(MSG, pemOf("RSA PRIVATE KEY", flipLast(8)), { digest: "SHA-256" })),
    ).toBe("E_COERCE");
    // d is not used with the prime factors, and a changed d is not read: the key still signs correctly
    const sig = topBytes(
      await sign(MSG, pemOf("RSA PRIVATE KEY", flipLast(3)), { digest: "SHA-256" }),
    );
    expect(hex(sig)).toBe(hex(topBytes(await sign(MSG, K1024, { digest: "SHA-256" }))));
    const rn = await publicKey(
      pemOf("RSA PRIVATE KEY", Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00)),
    );
    expect(message(rn)).toMatch(/9 INTEGERs/);
  });

  test("a multi-prime key (version 1) is E_RANGE", async () => {
    const d = Uint8Array.from(der(K1024));
    // SEQUENCE header is 4 bytes (30 82 xx xx), then 02 01 00: the version
    expect(Array.from(d.slice(4, 7))).toEqual([2, 1, 0]);
    d[6] = 1;
    expect(code(await publicKey(pemOf("RSA PRIVATE KEY", d)))).toBe("E_RANGE");
  });
});

describe("effects and metadata", () => {
  test("only the ops that read random bytes carry +random", async () => {
    const eff = async (r: Promise<Result>) => {
      const x = await r;
      return x.ok ? x.effects : ["error"];
    };
    const pub = await pubOf(K1024);
    const sig = topBytes(await sign(MSG, K1024));
    expect(await eff(generate("1024"))).toEqual(["+random"]);
    expect(await eff(encrypt(PT, pub))).toEqual(["+random"]);
    expect(await eff(sign(MSG, K1024, { scheme: "RSASSA-PSS", digest: "SHA-256" }))).toEqual([
      "+random",
    ]);
    expect(await eff(verify(sig, pub, MSG))).toEqual([]);
    expect(await eff(decrypt(topBytes(await encrypt(PT, pub)), K1024))).toEqual([]);
    expect(await eff(publicKey(K1024))).toEqual([]);
  });
});
