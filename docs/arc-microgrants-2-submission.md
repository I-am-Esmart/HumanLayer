# Arc Microgrants 2 submission worksheet

**Deadline:** November 1, 2026. The live Mainnet app and a real bounty-flow transaction are ready. The walkthrough video and final form submission remain outstanding.

Official submission: [Arc Microgrants: Built with Arc Studio](https://dorahacks.io/hackathon/arc-microgrants-2/detail)

## Ready-to-use project description

HumanLayer is a USDC bounty marketplace on Arc. Buyers post verifiable research and data tasks, escrow the reward, and pay workers when a submission is approved. HumanLayer connects AI agents and organizations to human judgment for work that needs review by a person. The project was built with Arc Studio and uses Solidity escrow contracts with a React application.

## Submission fields and proof

| Field | Value / status |
|---|---|
| Arc Studio project URL | `https://studio.arc.io/app/3889df65-98a8-4d8e-a3b6-7bfdfabfc102?thread=12a8aae7-ccc6-4a87-bd8c-f0a471efb21b` |
| Public app | [https://agent-human-layer.vercel.app/](https://agent-human-layer.vercel.app/) — live on Arc Mainnet; `/health` and `/api/bounties` confirm chain ID `5042` and the active contract. |
| Arc Mainnet HumanLayer contract | [`0x43762D26A9c035d70c04D3cef58Db46227073e1E`](https://explorer.arc.io/address/0x43762D26A9c035d70c04D3cef58Db46227073e1E) |
| Example Mainnet USDC transaction | [Claim reward: `0x8946186bcb9a61166920ebc269f81a54f43bad353e18351f7021831001dbd0a0`](https://explorer.arc.io/tx/0x8946186bcb9a61166920ebc269f81a54f43bad353e18351f7021831001dbd0a0) — pays the worker from the funded bounty. |
| Full bounty proof | Bounty `1`, submission `1`, reward `0.05 USDC`, worker received `0.049 USDC`, and `0.001 USDC` accrued as the 2% platform fee. See the transaction sequence below. |
| Public repository | `https://github.com/I-am-Esmart/HumanLayer` |
| Public builder profile | `https://github.com/I-am-Esmart` |
| Walkthrough video | **Still needed:** owner records Arc Studio project, live app, and Mainnet bounty transaction. |
| Submission status | **Not submitted yet.** Complete the video and submit the application on DoraHacks. |

## Confirmed Mainnet transaction sequence

All six transactions below are on Arc Mainnet and target the active contract above.

| Step | Transaction |
|---|---|
| Create bounty | [`0x1e1911240e1495a33824b8e20f619cc2ef9f5305ab8cf99d51b3d720fc608578`](https://explorer.arc.io/tx/0x1e1911240e1495a33824b8e20f619cc2ef9f5305ab8cf99d51b3d720fc608578) |
| Approve escrow USDC | [`0x772b9b408bb1aacd8766a0be56051f62340e8e35196d154ee71770541ac5e011`](https://explorer.arc.io/tx/0x772b9b408bb1aacd8766a0be56051f62340e8e35196d154ee71770541ac5e011) |
| Fund escrow | [`0x8ee42ba18015cc90467a33c7553887a09b4bc274e6e68bf0b22fdbc0fafa99fa`](https://explorer.arc.io/tx/0x8ee42ba18015cc90467a33c7553887a09b4bc274e6e68bf0b22fdbc0fafa99fa) |
| Submit work | [`0xdca5951837a570382c21bd2b4547407a2028ccf5f6af2ff0c817976ea8b65c57`](https://explorer.arc.io/tx/0xdca5951837a570382c21bd2b4547407a2028ccf5f6af2ff0c817976ea8b65c57) |
| Approve submission | [`0xc5f4e84d39c0604bac55697c048aba1f70462154e52536af6bf10d7b18338eee`](https://explorer.arc.io/tx/0xc5f4e84d39c0604bac55697c048aba1f70462154e52536af6bf10d7b18338eee) |
| Claim reward | [`0x8946186bcb9a61166920ebc269f81a54f43bad353e18351f7021831001dbd0a0`](https://explorer.arc.io/tx/0x8946186bcb9a61166920ebc269f81a54f43bad353e18351f7021831001dbd0a0) |

The separate worker-gas funding transfer is [`0x9ee198b0c4ba1ff7fd2e5d60503b1c78a928b5f42d03d57a1d179b07ffd6865f`](https://explorer.arc.io/tx/0x9ee198b0c4ba1ff7fd2e5d60503b1c78a928b5f42d03d57a1d179b07ffd6865f); it is not the bounty-payment proof.

Do not claim the earlier, superseded contract as the active deployment. The current production contract is v4 at the address listed above.
