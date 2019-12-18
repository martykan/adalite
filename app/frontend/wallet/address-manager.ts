import range from './helpers/range'
import {toBip32StringPath} from './helpers/bip32'
import {packAddress} from 'cardano-crypto.js'
import NamedError from '../helpers/NamedError'

const ByronAddressGenerator = (cryptoProvider, accountIndex: number, isChange: boolean) => async (
  i: number
) => {
  const scheme = cryptoProvider.getDerivationScheme()

  const path = scheme.toAbsoluteDerivationPath([
    accountIndex,
    isChange ? 1 : 0,
    i + scheme.startAddressIndex,
  ])
  const xpub = await cryptoProvider.deriveXpub(path)
  const hdPassphrase = scheme.type === 'v1' ? await cryptoProvider.getHdPassphrase() : undefined

  return {
    path,
    address: packAddress(path, xpub, hdPassphrase, scheme.number),
  }
}

const _AddressManager = ({
  addrGen,
  gapLimit,
  disableCaching, // good for tests
  blockchainExplorer,
}) => {
  if (!gapLimit) {
    throw NamedError('ParamsValidationError', `Invalid gap limit: ${gapLimit}`)
  }

  const deriveAddressMemo = {}

  async function cachedDeriveAddress(index: number) {
    const memoKey = index

    if (!deriveAddressMemo[memoKey] || disableCaching) {
      deriveAddressMemo[memoKey] = await addrGen(index)
    }

    return deriveAddressMemo[memoKey].address
  }

  async function deriveAddressesBlock(beginIndex: number, endIndex: number) {
    return await Promise.all(range(beginIndex, endIndex).map(cachedDeriveAddress))
  }

  async function discoverAddresses() {
    let addresses = []
    let from = 0
    let isGapBlock = false

    while (!isGapBlock) {
      const currentAddressBlock = await deriveAddressesBlock(from, from + gapLimit)

      isGapBlock = !(await blockchainExplorer.isSomeAddressUsed(currentAddressBlock))

      addresses =
        isGapBlock && addresses.length > 0 ? addresses : addresses.concat(currentAddressBlock)
      from += gapLimit
    }

    return addresses
  }

  // TODO(ppershing): we can probably get this info more easily
  // just by testing filterUnusedAddresses() backend call
  async function discoverAddressesWithMeta() {
    const addresses = await discoverAddresses()
    const usedAddresses = await blockchainExplorer.filterUsedAddresses(addresses)

    return addresses.map((address) => {
      return {
        address,
        bip32StringPath: toBip32StringPath(getAddressToAbsPathMapping()[address]),
        isUsed: usedAddresses.has(address),
      }
    })
  }

  function getAddressToAbsPathMapping() {
    const result = {}
    Object.keys(deriveAddressMemo).map((key) => {
      const value = deriveAddressMemo[key]
      result[value.address] = value.path
    })

    return result
  }

  return {
    discoverAddresses,
    discoverAddressesWithMeta,
    getAddressToAbsPathMapping,
    _deriveAddress: cachedDeriveAddress,
    _deriveAddresses: deriveAddressesBlock,
  }
}

const AddressManager = ({
  accountIndex,
  gapLimit,
  defaultAddressCount,
  cryptoProvider,
  disableCaching, // good for tests
  isChange,
  blockchainExplorer,
}) => {
  // for scheme.v1 we used to derive first defaultAddressCount addresses,
  // make sure we can re-discover them now
  if (defaultAddressCount > gapLimit) {
    throw NamedError('ParamsValidationError', 'Invalid default address count')
  }

  return _AddressManager({
    addrGen: ByronAddressGenerator(cryptoProvider, accountIndex, isChange),
    gapLimit,
    disableCaching, // good for tests
    blockchainExplorer,
  })
}

export default AddressManager
